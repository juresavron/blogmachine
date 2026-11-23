import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, contentToHtml } from './app.js';
import { createStore } from './store.js';
import { normalizeSiteUrl } from './network.js';

const temp = mkdtempSync(join(tmpdir(), 'blogmachine-test-'));
const requests: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
let wpFails = false;
let wpThrows = false;
let googlePending: Promise<void> | undefined;
let googleStarted: (() => void) | undefined;
const { app, store } = createApp({
  databasePath: join(temp, 'test.sqlite'), seed: false,
  env: { TEST_USERNAME: 'writer', TEST_APPLICATION_PASSWORD: 'test-secret', TEST_URL: 'https://blog.example', GOOGLE_ACCESS_TOKEN: 'google-secret' },
  wordpressRequest: async (url, init) => {
    requests.push({ url, ...init });
    if (wpThrows) throw new Error('Simulated connection interrupted after send');
    return { ok: !wpFails, status: wpFails ? 403 : 201, json: async () => ({ id: 42, link: 'https://blog.example/test-post/' }) };
  },
  googleRequest: async (url, init) => {
    requests.push({ url, ...init });
    googleStarted?.();
    if (googlePending) await googlePending;
    return { ok: true, status: 200, json: async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } }) };
  },
});
let server: Server;
let base: string;
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
before(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(temp, { recursive: true }); });

test('health and empty persisted state', async () => {
  assert.equal((await api('/health')).data.status, 'ok');
  const { data } = await api('/state');
  assert.deepEqual(data.posts, []);
  assert.deepEqual(data.sites, []);
  assert.equal(data.capabilities.googleConfigured, true);
});

test('site validation rejects private URLs, duplicate websites, and mismatched properties', async () => {
  for (const url of ['http://blog.example', 'https://127.0.0.1', 'https://10.1.2.3', 'https://[::1]', 'https://user:password@blog.example', 'https://blog.example:8080', 'https://hello.local']) {
    assert.equal((await api('/sites', 'POST', { name: 'Rejected', platform: 'wordpress', url })).status, 400, url);
  }
  assert.equal((await api('/sites', 'POST', { name: 'Mismatch', platform: 'wordpress', url: 'https://blog.example', searchConsoleProperty: 'sc-domain:other.example' })).status, 400);
  const created = await api('/sites', 'POST', { name: 'Demo', platform: 'demo', url: 'https://demo.example' });
  assert.equal(created.status, 201);
  assert.equal(created.data.credentialsConfigured, false);
  assert.equal((await api('/sites', 'POST', { name: 'Duplicate', platform: 'demo', url: 'https://demo.example/' })).status, 409);
});

test('draft CRUD validates site references, creates slugs, and persists edits', async () => {
  assert.equal((await api('/posts', 'POST', { title: 'No site', siteIds: ['missing'] })).status, 404);
  const created = await api('/posts', 'POST', { title: 'A useful story!', content: 'First paragraph.\n\nSecond paragraph.' });
  assert.equal(created.status, 201);
  assert.equal(created.data.slug, 'a-useful-story');
  assert.equal(created.data.status, 'draft');
  const updated = await api(`/posts/${created.data.id}`, 'PATCH', { excerpt: 'An introduction.' });
  assert.equal(updated.data.excerpt, 'An introduction.');
  assert.equal((await api(`/posts/${created.data.id}`, 'PATCH', { slug: 'Has Spaces' })).status, 400);
  assert.equal((await api(`/posts/${created.data.id}`, 'DELETE')).status, 204);
  assert.equal((await api(`/posts/${created.data.id}`, 'PATCH', { title: 'Gone' })).status, 404);
});

test('demo publishing is explicit, idempotent, and cannot claim Google indexing', async () => {
  const site = (await api('/state')).data.sites[0];
  const post = (await api('/posts', 'POST', { title: 'Demo story', content: 'A small story.' })).data;
  const first = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
  assert.equal(first.status, 200);
  const publication = first.data.publications[0];
  assert.equal(publication.mode, 'demo');
  assert.equal(publication.status, 'published');
  assert.equal(publication.indexingStatus, 'not_inspected');
  const second = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
  assert.equal(second.data.publications[0].id, publication.id);
  assert.equal((await api('/state')).data.publications.length, 1);
  assert.equal((await api(`/publications/${publication.id}/inspect`, 'POST', {})).status, 400);
  assert.equal((await api(`/sites/${site.id}/sitemap`, 'POST', {})).status, 400);
});

test('WordPress publishing keeps secrets private, escapes HTML, and updates the remote post on retry', async () => {
  const site = (await api('/sites', 'POST', { name: 'WordPress', url: 'https://blog.example', platform: 'wordpress', credentialKey: 'TEST', searchConsoleProperty: 'sc-domain:blog.example' })).data;
  assert.equal(site.credentialsConfigured, true);
  const post = (await api('/posts', 'POST', { title: 'Test post', content: 'Hello <script>bad()</script>\n\nLine one\nLine two', siteIds: [site.id] })).data;
  const published = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
  assert.equal(published.data.publications[0].status, 'published');
  assert.equal(published.data.publications[0].mode, 'live');
  assert.equal(published.data.publications[0].remoteId, undefined);
  const initial = requests.find(item => item.url.endsWith('/wp-json/wp/v2/posts'))!;
  const payload = JSON.parse(initial.body!);
  assert.equal(payload.content, '<p>Hello &lt;script&gt;bad()&lt;/script&gt;</p>\n<p>Line one<br>Line two</p>');
  await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
  assert.ok(requests.some(item => item.url.endsWith('/wp-json/wp/v2/posts/42')));
  const state = JSON.stringify((await api('/state')).data);
  assert.equal(state.includes('test-secret'), false);
  assert.equal(state.includes('google-secret'), false);
});

test('WordPress credentials cannot be reused for a different website URL', async () => {
  const site = (await api('/sites', 'POST', { name: 'Wrong destination', url: 'https://different.example', platform: 'wordpress', credentialKey: 'TEST' })).data;
  assert.equal(site.credentialsConfigured, false);
  const post = (await api('/posts', 'POST', { title: 'Private credentials', content: 'Useful content.' })).data;
  const before = requests.length;
  const result = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
  assert.equal(result.data.publications[0].status, 'failed');
  assert.match(result.data.publications[0].error, /TEST_URL/);
  assert.equal(requests.length, before);
});

test('website settings can be edited later without changing its publishing identity', async () => {
  const site = (await api('/sites', 'POST', { name: 'Later setup', url: 'https://later.example', platform: 'manual' })).data;
  const updated = await api(`/sites/${site.id}`, 'PATCH', { name: 'Updated website', searchConsoleProperty: 'sc-domain:later.example', credentialKey: 'LATER' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.name, 'Updated website');
  assert.equal(updated.data.searchConsoleProperty, 'sc-domain:later.example');
  assert.equal(updated.data.url, site.url);
  const renamed = await api(`/sites/${site.id}`, 'PATCH', { name: 'Renamed again' });
  assert.equal(renamed.data.searchConsoleProperty, 'sc-domain:later.example');
  assert.equal((await api(`/sites/${site.id}`, 'PATCH', { searchConsoleProperty: 'sc-domain:elsewhere.example' })).status, 400);
  assert.equal((await api(`/sites/${site.id}`, 'PATCH', { url: 'https://changed.example' })).status, 400);
});

test('failed WordPress updates preserve the known live article and allow updating its remote ID again', async () => {
  const state = (await api('/state')).data;
  const existing = state.publications.find((publication: { mode: string; status: string }) => publication.mode === 'live' && publication.status === 'published');
  wpFails = true;
  try {
    const result = await api(`/posts/${existing.postId}/publish`, 'POST', { siteIds: [existing.siteId] });
    assert.equal(result.data.publications[0].status, 'failed');
    const retained = (await api('/state')).data.publications.find((publication: { id: string }) => publication.id === existing.id);
    assert.equal(retained.status, 'published');
    assert.equal(retained.publishedAt, existing.publishedAt);
    assert.equal(retained.url, existing.url);
    assert.match(retained.error, /HTTP 403/);
  } finally { wpFails = false; }
  const result = await api(`/posts/${existing.postId}/publish`, 'POST', { siteIds: [existing.siteId] });
  assert.equal(result.data.publications[0].status, 'published');
  assert.ok(requests.at(-1)!.url.endsWith('/posts/42'));
});

test('uncertain WordPress create outcomes block repeated creates to prevent duplicate articles', async () => {
  const site = (await api('/state')).data.sites.find((item: { url: string }) => item.url === 'https://blog.example');
  const post = (await api('/posts', 'POST', { title: 'Uncertain creation', content: 'Useful content.' })).data;
  wpThrows = true;
  try {
    const first = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
    assert.match(first.data.publications[0].error, /automatic retries are paused/);
  } finally { wpThrows = false; }
  const before = requests.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
    assert.equal(result.data.publications[0].status, 'failed');
    assert.match(result.data.publications[0].error, /uncertain outcome/);
  }
  assert.equal(requests.length, before);
});

test('partial publishing records per-site errors without hiding successful sites', async () => {
  const state = (await api('/state')).data;
  const demo = state.sites.find((site: { platform: string }) => site.platform === 'demo');
  const missing = (await api('/sites', 'POST', { name: 'No credentials', platform: 'wordpress', url: 'https://no-credentials.example' })).data;
  const post = (await api('/posts', 'POST', { title: 'Partial story', content: 'Useful content.' })).data;
  const result = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [demo.id, missing.id] });
  assert.deepEqual(result.data.publications.map((publication: { status: string }) => publication.status), ['published', 'failed']);
  assert.match(result.data.publications[1].error, /APPLICATION_PASSWORD/);
  assert.equal((await api('/state')).data.posts.find((item: { id: string }) => item.id === post.id).status, 'published');
});

test('upstream WordPress failures are recorded with a useful safe error', async () => {
  wpFails = true;
  try {
    const state = (await api('/state')).data;
    const site = state.sites.find((item: { credentialKey: string }) => item.credentialKey === 'TEST');
    const post = (await api('/posts', 'POST', { title: 'Failed story', content: 'Useful content.' })).data;
    const result = await api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] });
    assert.equal(result.data.publications[0].status, 'failed');
    assert.match(result.data.publications[0].error, /HTTP 403/);
    assert.equal((await api('/state')).data.posts.find((item: { id: string }) => item.id === post.id).status, 'draft');
  } finally { wpFails = false; }
});

test('Google inspection reads status and sitemap submission uses the official property endpoint', async () => {
  const state = (await api('/state')).data;
  const publication = state.publications.find((item: { mode: string; status: string }) => item.mode === 'live' && item.status === 'published');
  const inspected = await api(`/publications/${publication.id}/inspect`, 'POST', {});
  assert.equal(inspected.status, 200);
  assert.equal(inspected.data.publication.indexingStatus, 'indexed');
  const submitted = await api(`/sites/${publication.siteId}/sitemap`, 'POST', { url: 'https://blog.example/wp-sitemap.xml' });
  assert.equal(submitted.data.submitted, true);
  assert.match(requests.at(-1)!.url, /^https:\/\/www.googleapis.com\/webmasters\/v3\/sites\/sc-domain%3Ablog.example\/sitemaps\//);
  assert.equal((await api(`/sites/${publication.siteId}/sitemap`, 'POST', { url: 'https://other.example/sitemap.xml' })).status, 400);
});

test('deleting a website removes local publication records and post associations', async () => {
  const state = (await api('/state')).data;
  const site = state.sites[0];
  assert.equal((await api(`/sites/${site.id}`, 'DELETE')).status, 204);
  const after = (await api('/state')).data;
  assert.equal(after.publications.some((publication: { siteId: string }) => publication.siteId === site.id), false);
  assert.equal(after.posts.some((post: { siteIds: string[] }) => post.siteIds.includes(site.id)), false);
});

test('an inspection finishing after local deletion cannot recreate orphan publications', async () => {
  const state = (await api('/state')).data;
  const publication = state.publications.find((item: { mode: string; status: string }) => item.mode === 'live' && item.status === 'published');
  let release!: () => void;
  const started = new Promise<void>(resolve => { googleStarted = resolve; });
  googlePending = new Promise<void>(resolve => { release = resolve; });
  try {
    const pending = api(`/publications/${publication.id}/inspect`, 'POST', {});
    await started;
    assert.equal((await api(`/posts/${publication.postId}`, 'DELETE')).status, 204);
    release();
    assert.equal((await pending).status, 404);
    assert.equal((await api('/state')).data.publications.some((item: { id: string }) => item.id === publication.id), false);
  } finally { release(); googlePending = undefined; googleStarted = undefined; }
});

test('cross-origin mutations are rejected', async () => {
  const response = await fetch(`${base}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ title: 'Untrusted' }) });
  assert.equal(response.status, 403);
});

test('database data survives closing and reopening; seed runs only once', () => {
  const path = join(temp, 'persistence.sqlite');
  const first = createStore(path);
  assert.equal(first.posts().length, 3);
  for (const post of first.posts()) first.deletePost(post.id);
  for (const site of first.sites()) first.deleteSite(site.id);
  first.close();
  const reopened = createStore(path);
  assert.equal(reopened.posts().length, 0);
  assert.equal(reopened.sites().length, 0);
  reopened.close();
});

test('plain text to HTML conversion and HTTPS normalization retain safe content', () => {
  assert.equal(contentToHtml('one & two\n\nthree'), '<p>one &amp; two</p>\n<p>three</p>');
  assert.equal(normalizeSiteUrl('https://blog.example/blog/'), 'https://blog.example/blog');
});
