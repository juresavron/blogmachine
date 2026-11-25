import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createStore, type Store } from './store.js';
import type { ContentStore } from './storage.js';
import { googleRequest, normalizeSiteUrl, UnsentRequestError, wordpressRequest, type OutboundRequest } from './network.js';
import { repositoryRoutes } from './repositories/routes.js';
import type { Post, Publication, Site } from './types.js';

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const siteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2000),
  platform: z.enum(['demo', 'wordpress', 'manual']),
  searchConsoleProperty: z.string().trim().max(2000).default(''),
  credentialKey: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,59}$/, 'Credential key must use uppercase letters, numbers, and underscores.').optional(),
});
const postFields = {
  title: z.string().trim().min(1).max(250),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens for the slug.').max(200),
  excerpt: z.string().max(1000),
  content: z.string().max(200_000),
  siteIds: z.array(z.string()).max(100),
};
const createPostSchema = z.object({ ...postFields, slug: postFields.slug.optional(), excerpt: postFields.excerpt.default(''), content: postFields.content.default(''), siteIds: postFields.siteIds.default([]) });
const updatePostSchema = z.object(postFields).partial();
const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180).replace(/-$/, '') || `post-${randomUUID().slice(0, 8)}`;
const now = () => new Date().toISOString();
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export const contentToHtml = (content: string) => content.split(/\n\s*\n/).filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n');

function checkedProperty(value: string, siteUrl: string) {
  if (!value) return '';
  const site = new URL(siteUrl);
  if (value.startsWith('sc-domain:')) {
    const domain = value.slice(10).toLowerCase();
    if (!domain || !(site.hostname === domain || site.hostname.endsWith(`.${domain}`))) throw new ApiError(400, 'Search Console property must match the website domain.');
    return `sc-domain:${domain}`;
  }
  let property: URL;
  try { property = new URL(value); } catch { throw new ApiError(400, 'Enter a URL-prefix property or sc-domain:example.com.'); }
  if (property.origin !== site.origin || property.username || property.password || property.search || property.hash) throw new ApiError(400, 'Search Console property must match the HTTPS website origin.');
  return property.toString();
}

export type AppOptions = {
  store?: ContentStore;
  databasePath?: string;
  seed?: boolean;
  env?: NodeJS.ProcessEnv;
  wordpressRequest?: OutboundRequest;
  googleRequest?: OutboundRequest;
  repositoriesWorkspace?: string;
  repositoriesRequest?: typeof fetch;
  repositoriesSessionNow?: () => number;
};

type AppInstance<T extends ContentStore> = { app: express.Express; store: T };

export function createApp(options?: AppOptions & { store?: undefined }): AppInstance<Store>;
export function createApp<T extends ContentStore>(options: AppOptions & { store: T }): AppInstance<T>;
export function createApp(options: AppOptions): AppInstance<ContentStore>;
export function createApp(options: AppOptions = {}): AppInstance<ContentStore> {
  const env = options.env ?? process.env;
  const store = options.store ?? createStore(options.databasePath ?? env.DATABASE_PATH ?? resolve('data/blogmachine.sqlite'), options.seed ?? true);
  const wpRequest = options.wordpressRequest ?? wordpressRequest;
  const gRequest = options.googleRequest ?? googleRequest;
  const activePublishes = new Set<string>();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      try {
        if (new URL(req.get('origin')!).host !== req.get('host')) throw new Error('Cross-origin request');
      } catch { return res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); }
    }
    next();
  });

  const configured = (site: Site) => {
    if (site.platform !== 'wordpress' || !env[`${site.credentialKey}_USERNAME`] || !env[`${site.credentialKey}_APPLICATION_PASSWORD`]) return false;
    try { return normalizeSiteUrl(env[`${site.credentialKey}_URL`] ?? '') === site.url; } catch { return false; }
  };
  const needSite = async (id: string) => { const site = await store.site(id); if (!site) throw new ApiError(404, 'Website not found.'); return site; };
  const needPost = async (id: string) => { const post = await store.post(id); if (!post) throw new ApiError(404, 'Post not found.'); return post; };
  const needPublication = async (id: string) => { const publication = await store.publication(id); if (!publication) throw new ApiError(404, 'Publication not found.'); return publication; };
  const checkSites = (ids: string[]) => Promise.all([...new Set(ids)].map(async id => (await needSite(id)).id));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/state', async (_req, res) => res.json({
    sites: (await store.sites()).map(site => ({ ...site, credentialsConfigured: configured(site) })),
    posts: await store.posts(),
    publications: (await store.publications()).map(({ remoteId: _remoteId, createOutcomeUnknown: _unknown, ...publication }) => publication),
    capabilities: { googleConfigured: Boolean(env.GOOGLE_ACCESS_TOKEN) },
  }));

  app.post('/api/connections/discover', async (req, res) => {
    const input = z.object({ url: z.string().trim().min(1).max(2000) }).parse(req.body);
    let url: string;
    try { url = normalizeSiteUrl(input.url); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid website URL.'); }
    const unknown = { url, platform: 'unknown' as const, wordpressDetected: false, credentialsRequired: false };
    let response;
    try {
      // Discovery never selects saved credentials, even for an existing website.
      response = await wpRequest(`${url}/wp-json/`, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch {
      return res.json({ ...unknown, reachable: false, message: 'Could not reach the website discovery endpoint. Check the HTTPS address and environment network access. Its publishing platform remains unverified.' });
    }
    if (!response.ok) {
      const message = response.status >= 300 && response.status < 400
        ? 'The website discovery endpoint redirected. Use its final canonical HTTPS website address; redirects are not followed. Its publishing platform remains unverified.'
        : `The website or environment network policy returned HTTP ${response.status}. Its publishing platform remains unverified; this does not mean the site is not WordPress.`;
      return res.json({ ...unknown, reachable: false, credentialsRequired: response.status === 401, message });
    }
    let metadata;
    try {
      metadata = z.object({
        namespaces: z.array(z.string()).optional(),
        routes: z.record(z.string(), z.object({ namespace: z.string().optional() })).optional(),
      }).parse(await response.json());
    } catch {
      return res.json({ ...unknown, reachable: true, message: 'The website responded, but the endpoint did not return recognizable WordPress discovery data. Its publishing platform remains unverified; WordPress may be hidden or its REST API disabled.' });
    }
    const wordpressDetected = Boolean(metadata.namespaces?.includes('wp/v2') || metadata.routes?.['/wp/v2/posts']);
    return res.json({
      url, platform: wordpressDetected ? 'wordpress' : 'unknown', reachable: true, wordpressDetected, credentialsRequired: wordpressDetected,
      message: wordpressDetected
        ? 'WordPress REST API detected. Add this website as WordPress and configure an application password to test publishing access. No content was created.'
        : 'The website responded without recognizable WordPress publishing routes. Its platform remains unverified; this does not rule out WordPress.',
    });
  });

  app.post('/api/sites/:id/test-connection', async (req, res) => {
    const site = await needSite(req.params.id);
    if (site.platform !== 'wordpress') throw new ApiError(400, 'Connection checks are available for WordPress websites. Demo and manual-export websites do not have a publishing API connection.');
    if (!configured(site)) throw new ApiError(409, `Configure ${site.credentialKey}_USERNAME, ${site.credentialKey}_APPLICATION_PASSWORD, and ${site.credentialKey}_URL (exactly ${site.url}) on the server before testing this connection.`);
    let response;
    try {
      response = await wpRequest(`${site.url}/wp-json/wp/v2/users/me?context=edit`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${env[`${site.credentialKey}_USERNAME`]}:${env[`${site.credentialKey}_APPLICATION_PASSWORD`]}`).toString('base64')}` },
      });
    } catch {
      return res.json({ authenticated: false, canPublish: null, message: 'Could not reach the WordPress account endpoint. Check the website address and environment network access. Authentication and publishing permission remain unverified.' });
    }
    if (!response.ok) {
      return res.json({
        authenticated: false, canPublish: response.status === 401 ? false : null,
        message: response.status === 401
          ? 'WordPress did not accept these credentials. Check the username and application password. No content was created.'
          : `The website or environment network policy returned HTTP ${response.status}. Authentication and publishing permission remain unverified. No content was created.`,
      });
    }
    let identity;
    try {
      identity = z.object({ id: z.number().int().positive(), capabilities: z.record(z.string(), z.boolean()).optional() }).parse(await response.json());
    } catch {
      return res.json({ authenticated: false, canPublish: null, message: 'The account endpoint did not return a valid authenticated WordPress identity. Check that this address is a WordPress site with REST API access. No content was created.' });
    }
    const canPublish = identity.capabilities?.publish_posts ?? null;
    return res.json({
      authenticated: true, canPublish,
      message: canPublish === true
        ? 'WordPress authentication is verified and the account reports publishing permission. No content was created.'
        : canPublish === false
          ? 'WordPress authentication is verified, but the account reports no publish_posts permission. No content was created.'
          : 'WordPress authentication is verified. Publishing permission remains unverified because the account response did not include it. No content was created.',
    });
  });

  app.post('/api/sites', async (req, res) => {
    const input = siteSchema.parse(req.body);
    let url: string;
    try { url = normalizeSiteUrl(input.url); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid website URL.'); }
    if ((await store.sites()).some(site => site.url.toLowerCase() === url.toLowerCase())) throw new ApiError(409, 'This website is already connected.');
    const credentialKey = input.credentialKey ?? input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
    const site: Site = { ...input, url, credentialKey: /^[A-Z]/.test(credentialKey) ? credentialKey : `SITE_${credentialKey || 'WEBSITE'}`, searchConsoleProperty: checkedProperty(input.searchConsoleProperty, url), id: randomUUID(), createdAt: now() };
    await store.putSite(site);
    res.status(201).json({ ...site, credentialsConfigured: configured(site) });
  });
  app.delete('/api/sites/:id', async (req, res) => {
    await needSite(req.params.id);
    if (activePublishes.size) throw new ApiError(409, 'Wait for publishing to finish before removing a website.');
    await store.deleteSite(req.params.id);
    res.status(204).end();
  });
  app.patch('/api/sites/:id', async (req, res) => {
    const existing = await needSite(req.params.id);
    if (activePublishes.size) throw new ApiError(409, 'Wait for publishing to finish before editing a website.');
    const input = siteSchema.pick({ name: true, credentialKey: true }).extend({ searchConsoleProperty: z.string().trim().max(2000) }).partial().strict().parse(req.body);
    const site = { ...existing, ...input, searchConsoleProperty: input.searchConsoleProperty === undefined ? existing.searchConsoleProperty : checkedProperty(input.searchConsoleProperty, existing.url) };
    await store.putSite(site);
    res.json({ ...site, credentialsConfigured: configured(site) });
  });

  app.post('/api/posts', async (req, res) => {
    const input = createPostSchema.parse(req.body);
    const timestamp = now();
    const post: Post = { ...input, slug: input.slug ?? slugify(input.title), siteIds: await checkSites(input.siteIds), id: randomUUID(), status: 'draft', createdAt: timestamp, updatedAt: timestamp };
    await store.putPost(post);
    res.status(201).json(post);
  });
  app.patch('/api/posts/:id', async (req, res) => {
    const existing = await needPost(req.params.id);
    if (activePublishes.has(existing.id)) throw new ApiError(409, 'Wait for this post to finish publishing before editing it.');
    const input = updatePostSchema.parse(req.body);
    const post = { ...existing, ...input, ...(input.siteIds ? { siteIds: await checkSites(input.siteIds) } : {}), updatedAt: now() };
    await store.putPost(post);
    res.json(post);
  });
  app.delete('/api/posts/:id', async (req, res) => {
    await needPost(req.params.id);
    if (activePublishes.has(req.params.id)) throw new ApiError(409, 'Wait for this post to finish publishing before deleting it.');
    await store.deletePost(req.params.id);
    res.status(204).end();
  });

  app.post('/api/posts/:id/publish', async (req, res) => {
    const post = await needPost(req.params.id);
    const input = z.object({ siteIds: z.array(z.string()).min(1, 'Select at least one website.').max(100) }).parse(req.body);
    const siteIds = await checkSites(input.siteIds);
    if (!post.content.trim()) throw new ApiError(400, 'Add post content before publishing.');
    if (activePublishes.has(post.id)) throw new ApiError(409, 'This post is already being published.');
    activePublishes.add(post.id);
    const publications: Publication[] = [];
    try {
      for (const siteId of siteIds) {
        const site = await needSite(siteId);
        const existing = (await store.publications()).find(item => item.postId === post.id && item.siteId === site.id);
        const publication: Publication = { id: existing?.id ?? randomUUID(), postId: post.id, siteId: site.id, url: existing?.url ?? `${site.url}/${post.slug}/`, status: 'published', mode: site.platform === 'demo' ? 'demo' : 'live', error: null, publishedAt: now(), indexingStatus: existing?.indexingStatus ?? 'not_inspected', lastInspectedAt: existing?.lastInspectedAt ?? null, ...(existing?.remoteId ? { remoteId: existing.remoteId } : {}), ...(existing?.createOutcomeUnknown ? { createOutcomeUnknown: true } : {}) };
        if (site.platform === 'wordpress' && !existing?.remoteId && !existing?.createOutcomeUnknown && configured(site)) {
          // Save the uncertainty marker before sending a first create. A crash or
          // lost database acknowledgement after WordPress accepts it must never
          // make the next process send another create automatically.
          try {
            await store.putPublication({ ...publication, status: 'failed', createOutcomeUnknown: true, error: 'A publishing attempt started without a durable result yet. If it was interrupted, check WordPress before trying again; automatic retries are paused to prevent duplicates.' });
          } catch {
            throw new ApiError(503, 'Could not record this publishing attempt safely. No article was sent. Restore workspace storage and try again.');
          }
          publication.createOutcomeUnknown = true;
        }
        try {
          if (site.platform === 'manual') throw new ApiError(400, 'This website uses manual publishing. Export or copy the post to your CMS.');
          if (site.platform === 'wordpress') {
            if (existing?.createOutcomeUnknown && !existing.remoteId) throw new ApiError(409, 'The previous publishing attempt had an uncertain outcome. Check WordPress for this article before publishing again; automatic retries are paused to prevent duplicates.');
            if (!configured(site)) throw new ApiError(409, `Configure ${site.credentialKey}_USERNAME, ${site.credentialKey}_APPLICATION_PASSWORD, and ${site.credentialKey}_URL (exactly ${site.url}) on the server to publish to this website.`);
            const username = env[`${site.credentialKey}_USERNAME`]!;
            const password = env[`${site.credentialKey}_APPLICATION_PASSWORD`]!;
            const endpoint = `${site.url}/wp-json/wp/v2/posts${existing?.remoteId ? `/${existing.remoteId}` : ''}`;
            let response;
            let result;
            try {
              response = await wpRequest(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
                body: JSON.stringify({ title: escapeHtml(post.title), slug: post.slug, excerpt: contentToHtml(post.excerpt), content: contentToHtml(post.content), status: 'publish' }),
              });
              if (response.ok) result = z.object({ id: z.number().int().positive(), link: z.string().url() }).parse(await response.json());
            } catch (error) {
              if (error instanceof UnsentRequestError) {
                delete publication.createOutcomeUnknown;
                throw new ApiError(502, 'Could not reach WordPress before sending the article. Check the website connection and network permissions, then retry.');
              }
              if (!existing?.remoteId) publication.createOutcomeUnknown = true;
              throw new ApiError(502, existing?.remoteId ? 'WordPress did not confirm this update. The existing article is still recorded; you can retry updating it.' : 'WordPress did not confirm whether this article was created. Check the website before trying again; automatic retries are paused to prevent duplicates.');
            }
            if (!response.ok) {
              // Explicit client rejection establishes that no new article was
              // accepted. Server errors, timeouts, and redirects can be ambiguous.
              const rejected = [400, 401, 403, 404, 405, 410, 415, 422].includes(response.status);
              if (rejected) delete publication.createOutcomeUnknown;
              throw new ApiError(502, `WordPress returned HTTP ${response.status}. Check the website URL, application password, and publishing permissions.${publication.createOutcomeUnknown ? ' The create outcome remains uncertain; check WordPress before trying again. Automatic retries are paused to prevent duplicates.' : ''}`);
            }
            publication.remoteId = result!.id;
            delete publication.createOutcomeUnknown;
            const remoteUrl = new URL(result!.link);
            if (remoteUrl.origin !== new URL(site.url).origin || remoteUrl.username || remoteUrl.password) throw new ApiError(502, 'WordPress returned a publication URL outside the connected website.');
            publication.url = result!.link;
          }
        } catch (error) {
          publication.status = 'failed';
          publication.error = error instanceof ApiError ? error.message : 'Could not publish to this website. Check its connection and WordPress API response.';
        }
        try {
          await store.putPublication(publication.status === 'failed' && existing?.status === 'published' && existing.remoteId ? { ...existing, error: publication.error } : publication);
        } catch {
          throw new ApiError(503, site.platform === 'wordpress' && !existing?.remoteId
            ? 'Could not save the publishing result. Check WordPress before trying again; the saved uncertainty marker prevents automatic duplicate creates.'
            : 'Could not save the publishing result. Restore workspace storage before retrying.');
        }
        publications.push(publication);
      }
      const published = (await store.publications()).some(item => item.postId === post.id && item.status === 'published');
      await store.putPost({ ...post, siteIds: [...new Set([...post.siteIds, ...siteIds])], status: published ? 'published' : post.status, updatedAt: now() });
      res.json({ publications: publications.map(({ remoteId: _remoteId, createOutcomeUnknown: _unknown, ...publication }) => publication) });
    } finally { activePublishes.delete(post.id); }
  });

  app.post('/api/publications/:id/inspect', async (req, res) => {
    const publication = await needPublication(req.params.id);
    const site = await needSite(publication.siteId);
    if (publication.mode === 'demo') throw new ApiError(400, 'Demo URLs cannot be inspected by Google. Connect and publish to a real website first.');
    if (publication.status !== 'published') throw new ApiError(400, 'Publish this post successfully before inspecting its URL.');
    if (!site.searchConsoleProperty) throw new ApiError(409, 'Add the website with its verified Search Console property before inspecting URLs.');
    if (!env.GOOGLE_ACCESS_TOKEN) throw new ApiError(409, 'Configure GOOGLE_ACCESS_TOKEN on the server with Search Console access to this property.');
    try {
      const response = await gRequest('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST', headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionUrl: publication.url, siteUrl: site.searchConsoleProperty, languageCode: 'en-US' }),
      });
      if (!response.ok) throw new Error(`Google returned HTTP ${response.status}.`);
      const result = z.object({ inspectionResult: z.object({ inspectionResultLink: z.string().optional(), indexStatusResult: z.object({ verdict: z.string().optional(), coverageState: z.string().optional(), lastCrawlTime: z.string().optional() }).optional() }) }).parse(await response.json());
      const verdict = result.inspectionResult.indexStatusResult?.verdict;
      const indexingStatus = verdict === 'PASS' ? 'indexed' : verdict === 'FAIL' || verdict === 'NEUTRAL' ? 'not_indexed' : 'inspection_failed';
      const current = await needPublication(publication.id);
      if (current.url !== publication.url || current.publishedAt !== publication.publishedAt) throw new ApiError(409, 'This publication changed during inspection. Inspect its current URL again.');
      const updated: Publication = { ...current, indexingStatus, lastInspectedAt: now() };
      await store.putPublication(updated);
      const { remoteId: _remoteId, createOutcomeUnknown: _unknown, ...publicPublication } = updated;
      res.json({ publication: publicPublication, inspectionResult: result.inspectionResult });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const current = await store.publication(publication.id);
      if (current && current.url === publication.url && current.publishedAt === publication.publishedAt) await store.putPublication({ ...current, indexingStatus: 'inspection_failed', lastInspectedAt: now() });
      throw new ApiError(502, 'Google inspection failed. Check the access token, Search Console property permissions, and API quota.');
    }
  });

  app.post('/api/sites/:id/sitemap', async (req, res) => {
    const site = await needSite(req.params.id);
    if (site.platform === 'demo') throw new ApiError(400, 'Demo websites cannot submit sitemaps. Connect a real website first.');
    if (!site.searchConsoleProperty) throw new ApiError(409, 'A verified Search Console property is required to submit a sitemap.');
    if (!env.GOOGLE_ACCESS_TOKEN) throw new ApiError(409, 'Configure GOOGLE_ACCESS_TOKEN on the server to submit sitemaps.');
    const input = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    const sitemapUrl = input.url ?? `${site.url}/sitemap.xml`;
    const parsed = new URL(sitemapUrl);
    if (parsed.origin !== new URL(site.url).origin || parsed.username || parsed.password || parsed.hash) throw new ApiError(400, 'The sitemap must be on the connected HTTPS website.');
    let response;
    try {
      response = await gRequest(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.searchConsoleProperty)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT', headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` } });
    } catch { throw new ApiError(502, 'Could not reach Google Search Console. Try again later.'); }
    if (!response.ok) throw new ApiError(502, `Google returned HTTP ${response.status}. Check the access token and Search Console property permissions.`);
    res.json({ submitted: true, url: sitemapUrl, message: 'Sitemap submitted to Search Console. Google decides when to crawl and index URLs.' });
  });

  app.use('/api', repositoryRoutes(store, { workspace: options.repositoriesWorkspace ?? env.BLOGMACHINE_REPOSITORIES_ROOT ?? '/workspace', env, request: options.repositoriesRequest, now: options.repositoriesSessionNow }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join(' ') });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Send valid JSON.' });
    console.error('API error:', error instanceof Error ? error.name : 'Unknown error');
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return { app, store };
}
