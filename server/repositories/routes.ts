import { createRepositorySources } from './snapshots.js';
import { importedIdentity } from './snapshot-identity.js';
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import { definitions, definition, gitAdapters, checkedRepositoryRoot, gitIdentity } from './catalog.js';
import { assertMediaspedSourceSlugAvailable } from './media-source.js';
import { databaseEnvironment } from './environment.js';
import { listMediaspedArticles, prepareMediaspedDraft, createMediaspedDraft } from './mediasped.js';
import { listTrgovinaArticles, prepareTrgovinaDraft, testTrgovinaConnection, TrgovinaReadError } from './trgovina.js';
import type { Awaitable, ContentStore } from '../storage.js';
import { createMediaspedSessions, mediaspedSessionError } from './mediasped-sessions.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
class RepositoryError extends Error { constructor(public status: number, message: string) { super(message); } }
async function stored<T>(operation: () => Awaitable<T>): Promise<T> {
  try { return await operation(); }
  catch { throw new RepositoryError(503, 'Workspace storage is temporarily unavailable. Please try again.'); }
}
const plain = z.string().trim().min(1).max(200_000).refine(value => !value.includes('<'), 'Use plain text without < characters in repository content.');
const metadataSchema = z.record(z.string().max(80), z.unknown());
export type PreparedChange = {
  id: string; repositoryId: string; targetKey: string; postId: string; postTitle: string;
  format: 'git-patch' | 'database-draft'; relativePath: string; articleUrl: string;
  baseHead: string; sourceHash: string; createdAt: string; status: 'prepared';
  instructions: string; warnings: string[]; artifact: string; remoteDraftSavedAt?: string;
};
const publicChange = ({ artifact: _artifact, ...item }: PreparedChange) => ({ ...item, downloadUrl: `/api/repository-changes/${item.id}/download` });

export function repositoryRoutes(store: ContentStore, options: { workspace: string; env: NodeJS.ProcessEnv; request?: typeof fetch; now?: () => number }) {
  const router = Router();
  const sources = createRepositorySources(store, options.workspace);
  const rootFor = (id: string) => sources.root(id);
  const mediaspedSessions = createMediaspedSessions({ ...options, repositoryRoot: rootFor });
  router.use(mediaspedSessions.router);
  async function source(root: string, relativePath: string) {
    const path = await realpath(resolve(root, relativePath));
    if (path !== resolve(root, relativePath)) throw new RepositoryError(409, 'The content file is a symlink. Review it before preparing changes.');
    return readFile(path, 'utf8');
  }
  async function snapshot(root: string, target: { contentPath: string; additionalPaths?: string[] }) {
    const files = await Promise.all([target.contentPath, ...(target.additionalPaths ?? [])].map(async path => ({ path, text: await source(root, path) })));
    return { files, hash: files.length === 1 ? hash(files[0].text) : hash(JSON.stringify(files)) };
  }
  router.get('/repositories', async (_req, res) => {
    const repositories = await Promise.all(definitions().map(async item => {
      if (item.kind === 'empty') return { ...item, available: false, branch: null, head: null, message: 'Empty repository; no content adapter.' };
      try { const root = await rootFor(item.id); return { ...item, ...await gitIdentity(root), available: true, source: importedIdentity(root) ? 'snapshot' : 'checkout', importedAt: importedIdentity(root)?.importedAt, message: importedIdentity(root) ? 'Saved source snapshot. Refresh it after website source changes; live publication and administrator access are separate.' : item.kind === 'database' ? 'Schema inspected; database access is separate.' : 'Local source is available. Live deployment is not verified.' }; }
      catch { return { ...item, available: false, branch: null, head: null, message: 'Repository checkout is unavailable. Restore it before preparing content.' }; }
    }));
    res.json({ repositories, changes: (await stored(() => store.repositoryChanges())).map(publicChange) });
  });
  router.post('/repositories/:id/source', async (req, res) => {
    const source = await sources.import(req.params.id, req.body);
    res.status(201).json({ id: source.id, head: source.head, branch: source.branch, importedAt: source.importedAt, message: 'Website source saved. Administrator sign-in and publication remain separate.' });
  });
  router.get('/repositories/:id/articles', async (req, res) => {
    const item = definition(req.params.id);
    const targetKey = z.string().min(1).parse(req.query.target);
    const target = item.targets.find(target => target.key === targetKey);
    if (!target) throw new RepositoryError(400, 'Select a configured website or country.');
    if (item.kind === 'database') {
      try { const env = await databaseEnvironment(item.id, options.workspace, options.env, rootFor); return res.json({ articles: item.id === 'mediasped' ? await listMediaspedArticles(targetKey, env, options.request) : await listTrgovinaArticles(targetKey, env, options.request), sourceHash: '', message: 'Published database articles; not static buying guides.' }); }
      catch (error) { if (error instanceof TrgovinaReadError) throw new RepositoryError(409, error.message); throw new RepositoryError(409, 'Could not read the database blog. Check its public Supabase configuration and network access. Repository access does not grant database admin access.'); }
    }
    const adapter = gitAdapters[item.id];
    if (!adapter) throw new RepositoryError(400, 'This repository has no supported content adapter.');
    const root = await rootFor(item.id);
    const before = await snapshot(root, target);
    const articles = await adapter.list(root, targetKey);
    res.json({ articles, sourceHash: before.hash, message: 'Read from the selected source revision; publication on the live website is not verified.' });
  });
  router.post('/repositories/:id/test-connection', async (req, res) => {
    const item = definition(req.params.id);
    if (item.id === 'mediasped') {
      const status = await mediaspedSessions.status(req);
      return res.json({ ...status, configured: status.authenticated });
    }
    if (item.kind === 'database') { const env = await databaseEnvironment(item.id, options.workspace, options.env, rootFor); return res.json(await testTrgovinaConnection(env, options.request)); }
    if (item.kind === 'empty') throw new RepositoryError(409, 'This repository has no website code yet.');
    const root = await rootFor(item.id);
    res.json({ readable: true, ...await gitIdentity(root), message: 'Website source is readable. This does not verify deployment or live publishing access.' });
  });
  router.post('/repositories/:id/prepare', async (req, res) => {
    const item = definition(req.params.id);
    const input = z.object({ postId: z.string().min(1), targetKey: z.string().min(1), expectedHead: z.string().regex(/^[a-f0-9]{40}$/), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), metadata: metadataSchema.default({}) }).parse(req.body);
    const target = item.targets.find(t => t.key === input.targetKey);
    if (!target) throw new RepositoryError(400, 'Select a configured website or country.');
    const post = await stored(() => store.post(input.postId));
    if (!post) throw new RepositoryError(404, 'The selected Blog Machine draft no longer exists.');
    const draft = z.object({ title: plain.max(250), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200), excerpt: z.string().trim().min(1, 'Add a short description to this post before preparing a repository change.').max(1000).refine(value => !value.includes('<'), 'Use plain text in the short description.'), content: plain }).parse(post);
    // Never interpolate unvalidated metadata into executable source or markup.
    if (JSON.stringify(input.metadata).includes('<')) throw new RepositoryError(400, 'Use plain-text metadata without < characters.');
    const root = await rootFor(item.id);
    const identity = await gitIdentity(root);
    if (identity.head !== input.expectedHead) throw new RepositoryError(409, 'The repository changed. Reload its articles before preparing a change.');
    let artifact: string, relativePath: string, articleUrl: string, sourceHash = '';
    const format = item.kind === 'database' ? 'database-draft' : 'git-patch';
    if (item.kind === 'database') {
      if (item.id === 'mediasped') await assertMediaspedSourceSlugAvailable(root, draft.slug);
      const payload = item.id === 'mediasped' ? prepareMediaspedDraft(draft, target.key, input.metadata) : prepareTrgovinaDraft(draft, target.key);
      artifact = JSON.stringify(payload, null, 2) + '\n';
      relativePath = item.id === 'mediasped' ? 'public.blog_posts' : 'public.posts'; articleUrl = `${target.url}/blog/${draft.slug}${item.id === 'mediasped' ? '/' : ''}`;
    } else {
      const adapter = gitAdapters[item.id];
      if (!adapter) throw new RepositoryError(400, 'This repository has no supported content adapter.');
      const before = await snapshot(root, target);
      sourceHash = before.hash;
      if (!input.expectedSourceHash || input.expectedSourceHash !== sourceHash) throw new RepositoryError(409, 'The content changed or was not loaded. Reload its articles before preparing a patch.');
      const change = await adapter.prepare(root, target.key, draft, input.metadata);
      const changes = [change, ...(change.additionalChanges ?? [])];
      if (new Set(changes.map(c => c.relativePath)).size !== changes.length) throw new RepositoryError(400, 'The adapter returned duplicate file changes.');
      for (const part of changes) {
        if (before.files.find(file => file.path === part.relativePath)?.text !== part.before) throw new RepositoryError(409, 'Content changed or an unexpected file was returned. Reload and retry.');
      }
      if ((await snapshot(root, target)).hash !== sourceHash || (await gitIdentity(root)).head !== identity.head) throw new RepositoryError(409, 'The repository changed during preparation. Reload and retry.');
      artifact = changes.filter(c => c.before !== c.after).map(part => createTwoFilesPatch(`a/${part.relativePath}`, `b/${part.relativePath}`, part.before, part.after, '', '', { context: 3 })).join('\n');
      if (!artifact) throw new RepositoryError(409, 'This content already matches the source. There is no new change to prepare.');
      relativePath = changes.map(c => c.relativePath).join(', '); articleUrl = change.articleUrl;
    }
    const prepared: PreparedChange = { id: randomUUID(), repositoryId: item.id, targetKey: target.key, postId: post.id, postTitle: post.title, format, relativePath, articleUrl, baseHead: identity.head, sourceHash, createdAt: new Date().toISOString(), status: 'prepared', instructions: item.deployment, warnings: item.warnings, artifact };
    await stored(() => store.putRepositoryChange(prepared));
    res.status(201).json({ change: publicChange(prepared), preview: artifact });
  });
  router.post('/repository-changes/:id/save-draft', async (req, res) => {
    const change = await stored(() => store.repositoryChange(req.params.id));
    if (!change) throw new RepositoryError(404, 'Prepared draft not found.');
    if (change.repositoryId !== 'mediasped' || change.format !== 'database-draft') throw new RepositoryError(400, 'This connection requires a reviewed Git/deployment or external admin workflow.');
    const root = await rootFor(change.repositoryId);
    const payload = JSON.parse(change.artifact);
    await assertMediaspedSourceSlugAvailable(root, payload.slug);
    const connection = await mediaspedSessions.resolve(req);
    // Never overwrite an existing article or turn a draft into a publication.
    await createMediaspedDraft(payload, connection.env, connection.request);
    const saved = { ...change, remoteDraftSavedAt: new Date().toISOString() };
    await stored(() => store.putRepositoryChange(saved));
    res.json({ change: publicChange(saved), message: 'Unpublished website draft saved. Review and publish it through the existing Mediašped editor.' });
  });
  router.get('/repository-changes/:id/download', async (req, res) => {
    const item = await stored(() => store.repositoryChange(req.params.id));
    if (!item) throw new RepositoryError(404, 'Prepared change not found.');
    res.type(item.format === 'git-patch' ? 'text/x-diff' : 'application/json');
    res.attachment(`${item.repositoryId}-${item.targetKey}-${item.id.slice(0,8)}.${item.format === 'git-patch' ? 'patch' : 'json'}`);
    res.send(item.artifact);
  });
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const sessionError = mediaspedSessionError(error);
    if (sessionError) return res.status(sessionError.status).json({ error: sessionError.message });
    if (error instanceof RepositoryError) return res.status(error.status).json({error:error.message});
    if (error instanceof z.ZodError) return res.status(400).json({error:error.issues.map(issue=>issue.message).join(' ')});
    if (error instanceof Error) return res.status(400).json({error: 'Could not prepare or read this repository content. ' + (error.message.startsWith('ENOENT') ? 'The content file is unavailable.' : error.message.slice(0,300)) });
    next(error);
  });
  return router;
}

