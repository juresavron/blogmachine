import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.js';

const project = 'https://ytmowbzkpofeeocgevyr.supabase.co';
const authorId = 'a48f3579-60dd-4d92-b8d0-bb1e7774b2ec';
const userToken = `fixture.${Buffer.from(JSON.stringify({ role: 'authenticated', sub: authorId })).toString('base64url')}.not-a-real-signature`;
const browserToken = `fixture.${Buffer.from(JSON.stringify({ role: 'authenticated', sub: authorId, label: 'browser' })).toString('base64url')}.not-a-real-signature`;
const publishableKey = 'public-fixture-key-not-real';
const draft = { title: 'A new shipping plan', slug: 'a-new-shipping-plan', excerpt: 'Prepare useful information for your next shipment.', content: '## Cargo information\n\nWrite down the dimensions and weight.\n\n## Next step\n\nAsk for a quote.' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
interface SeenRequest { url: URL; init: RequestInit; }

async function fixture(t: TestContext) {
  const temp = await mkdtemp(join(tmpdir(), 'blogmachine-media-api-'));
  const workspace = join(temp, 'workspace');
  async function addRepository(directory: string, repository: string) {
    const root = join(workspace, directory);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'README.md'), '# Isolated database connector fixture\n');
    if (directory === 'mediasped-landing-lovable-15') {
      await mkdir(join(root, 'src/data'), { recursive: true });
      await writeFile(join(root, 'src/data/logisticsGuides.ts'), 'export const logisticsGuides = [];\n');
      await writeFile(join(root, 'src/data/logisticsGuideSummaries.ts'), 'export const guideSummaries = [];\n');
    }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Blog Machine Database Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('remote', 'add', 'origin', `https://github.com/${repository}.git`);
    git('add', '.');
    git('commit', '-m', 'Create isolated database fixture');
    return { root, head: git('rev-parse', 'HEAD'), git };
  }
  const repository = await addRepository('mediasped-landing-lovable-15', 'juresavron/mediasped-landing-lovable-15');
  const requests: SeenRequest[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const controls = { admin: true, identityAccepted: true, tableStatus: 201, throwTable: false };
  const inserts: Record<string, unknown>[] = [];
  const request: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    assert.equal(url.origin, project, 'No arbitrary external destination is allowed in this fixture.');
    assert.equal(init.redirect, 'error');
    requests.push({ url, init });
    if (url.pathname === '/auth/v1/token') return json({ access_token: browserToken, refresh_token: 'private-browser-refresh', expires_in: 3600 });
    if (url.pathname === '/auth/v1/logout') { assert.equal(url.searchParams.get('scope'), 'local'); return new Response(null, { status: 204 }); }
    if (url.pathname === '/auth/v1/user') {
      assert.equal(init.method, 'GET');
      return controls.identityAccepted ? json({ id: authorId, email: 'private-fixture@example.invalid' }) : json({ error: userToken }, 401);
    }
    if (url.pathname === '/rest/v1/rpc/is_admin') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), { _user_id: authorId });
      return json(controls.admin);
    }
    assert.equal(url.pathname, '/rest/v1/blog_posts');
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      inserts.push(body);
      assert.equal(body.published, false);
      assert.equal(body.published_at, null);
      assert.equal(body.author_id, authorId);
      if (controls.throwTable) throw new Error(`private network diagnostic: ${userToken}`);
      if (rows.has(String(body.id))) return json({ error: 'duplicate primary key' }, 409);
      if (controls.tableStatus !== 201) return json({ error: userToken }, controls.tableStatus);
      rows.set(String(body.id), body);
      return json([body], 201);
    }
    assert.equal(init.method, 'GET');
    if (url.searchParams.has('id')) {
      const id = url.searchParams.get('id')!.replace(/^eq\./, '');
      const language = url.searchParams.get('language')!.replace(/^eq\./, '');
      return json([...rows.values()].filter(row => row.id === id && row.language === language));
    }
    assert.equal(url.searchParams.get('published'), 'eq.true');
    const language = url.searchParams.get('language')!.replace(/^eq\./, '');
    return json([{ slug: 'an-existing-shipment-guide', title: 'An existing shipment guide', excerpt: 'Existing public content.', language }]);
  };
  const databasePath = join(temp, 'blogmachine.sqlite');
  const { app, store } = createApp({
    databasePath, seed: false, repositoriesWorkspace: workspace, repositoriesRequest: request,
    env: { MEDIASPED_SUPABASE_URL: project, MEDIASPED_SUPABASE_ANON_KEY: publishableKey, MEDIASPED_SUPABASE_ACCESS_TOKEN: userToken },
  });
  const server: Server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture server port.');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    await rm(temp, { recursive: true, force: true });
  });
  async function api(path: string, method = 'GET', body?: unknown, cookie = '') {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie() };
  }
  async function createDraft(replacement: Partial<typeof draft> = {}) {
    const result = await api('/posts', 'POST', { ...draft, ...replacement });
    assert.equal(result.status, 201);
    return result.data as typeof draft & { id: string };
  }
  async function prepare(postId: string, targetKey = 'sl') {
    return api('/repositories/mediasped/prepare', 'POST', { postId, targetKey, expectedHead: repository.head, metadata: {} });
  }
  return { ...repository, base, databasePath, rows, requests, inserts, controls, store, api, createDraft, prepare, addRepository };
}
function hasSecret(value: unknown) {
  const serialized = JSON.stringify(value);
  return [userToken, browserToken, 'private-browser-refresh', publishableKey, authorId, 'private-fixture@example.invalid', 'private-login-password'].some(secret => serialized.includes(secret));
}

test('Media repository listing and connection test use the injected read-only requests without leaking credentials', async t => {
  const f = await fixture(t);
  const registry = await f.api('/repositories');
  const media = registry.data.repositories.find((item: { id: string }) => item.id === 'mediasped');
  assert.equal(media.available, true);
  assert.equal(media.head, f.head);
  assert.equal(hasSecret(registry.data), false);
  const articles = await f.api('/repositories/mediasped/articles?target=sl');
  assert.equal(articles.status, 200);
  assert.equal(articles.data.articles[0].url, 'https://mediasped.com/sl/blog/an-existing-shipment-guide/');
  const listing = f.requests[0];
  assert.equal(listing.init.method, 'GET');
  assert.equal(new Headers(listing.init.headers).get('Authorization'), `Bearer ${publishableKey}`);
  assert.equal(listing.url.searchParams.get('language'), 'eq.sl');
  const connection = await f.api('/repositories/mediasped/test-connection', 'POST');
  assert.equal(connection.status, 200);
  assert.equal(connection.data.authenticated, true);
  assert.equal(connection.data.admin, true);
  assert.equal(hasSecret(connection.data), false);
  assert.equal(f.inserts.length, 0);
  assert.equal(f.rows.size, 0);
});

test('Media prepare creates a stable downloadable unpublished payload without an outbound write', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 201);
  assert.equal(prepared.data.change.status, 'prepared');
  assert.equal(prepared.data.change.format, 'database-draft');
  assert.equal(prepared.data.change.relativePath, 'public.blog_posts');
  const payload = JSON.parse(prepared.data.preview);
  assert.match(payload.id, /^[a-f0-9-]{36}$/);
  assert.equal(payload.published, false);
  assert.equal(payload.published_at, null);
  assert.equal(payload.language, 'sl');
  assert.equal(payload.author_id, undefined);
  assert.equal(f.requests.length, 0);
  const download = await fetch(`${f.base}${prepared.data.change.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.deepEqual(await download.json(), payload);
  assert.equal(hasSecret(prepared.data), false);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(await readFile(join(f.root, 'README.md'), 'utf8'), '# Isolated database connector fixture\n');
});

test('Media save-draft persists a remote draft result and duplicate retries never duplicate, publish, or overwrite content', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 201);
  const payload = JSON.parse(prepared.data.preview);
  const route = `/repository-changes/${prepared.data.change.id}/save-draft`;
  const first = await f.api(route, 'POST');
  assert.equal(first.status, 200);
  assert.equal(first.data.change.status, 'prepared');
  assert.ok(Number.isFinite(Date.parse(first.data.change.remoteDraftSavedAt)));
  assert.match(first.data.message, /unpublished/i);
  assert.equal(hasSecret(first.data), false);
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get(payload.id)?.published, false);
  assert.equal(f.rows.get(payload.id)?.published_at, null);
  const again = await f.api(route, 'POST');
  assert.equal(again.status, 200);
  assert.equal(f.rows.size, 1);
  assert.equal(f.inserts.length, 2);
  assert.ok(f.inserts.every(insert => insert.id === payload.id && insert.published === false));
  const conflictRead = f.requests.find(request => request.url.pathname === '/rest/v1/blog_posts' && request.init.method === 'GET' && request.url.searchParams.has('id'));
  assert.equal(conflictRead?.url.searchParams.get('id'), `eq.${payload.id}`);
  assert.equal(conflictRead?.url.searchParams.get('language'), 'eq.sl');
  assert.equal(f.requests.some(request => ['PATCH', 'PUT', 'DELETE'].includes(request.init.method || '')), false);
  const state = await f.api('/state');
  assert.equal(state.data.posts.find((item: { id: string }) => item.id === post.id).status, 'draft');
  assert.deepEqual(state.data.publications, []);
  const registry = await f.api('/repositories');
  const change = registry.data.changes.find((item: { id: string }) => item.id === prepared.data.change.id);
  assert.ok(change.remoteDraftSavedAt);
  assert.equal(change.artifact, undefined);
  assert.equal(hasSecret(registry.data), false);
  const reopened = new DatabaseSync(f.databasePath);
  try {
    const stored = reopened.prepare('SELECT data FROM repository_changes WHERE id = ?').get(change.id) as { data: string };
    const persisted = JSON.parse(stored.data);
    assert.equal(JSON.parse(persisted.artifact).id, payload.id);
    assert.ok(persisted.remoteDraftSavedAt);
  } finally { reopened.close(); }
  assert.equal(f.git('status', '--porcelain'), '');
});

test('browser login scopes actual draft saving and logout prevents falling back to an ambient administrator token', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  const route = `/repository-changes/${prepared.data.change.id}/save-draft`;
  const initial = await f.api('/connections/mediasped/session');
  const clientCookie = initial.cookies.map(value => value.split(';')[0]).join('; ');
  const login = await f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password: 'private-login-password' }, clientCookie);
  assert.equal(login.status, 200);
  assert.equal(login.data.source, 'browser');
  const cookie = login.cookies.map(value => value.split(';')[0]).join('; ');
  const saved = await f.api(route, 'POST', undefined, cookie);
  assert.equal(saved.status, 200);
  const insert = f.requests.filter(request => request.url.pathname === '/rest/v1/blog_posts' && request.init.method === 'POST').at(-1)!;
  assert.equal(new Headers(insert.init.headers).get('Authorization'), `Bearer ${browserToken}`);
  assert.equal(f.rows.size, 1);
  const logout = await f.api('/connections/mediasped/logout', 'POST', undefined, cookie);
  const disconnectedCookie = logout.cookies.map(value => value.split(';')[0]).join('; ');
  const before = f.inserts.length;
  assert.equal((await f.api(route, 'POST', undefined, disconnectedCookie)).status, 401);
  assert.equal((await f.api(route, 'POST', undefined, cookie)).status, 401);
  assert.equal(f.inserts.length, before);
  assert.equal(hasSecret(saved.data), false);
  const persisted = f.store.db.prepare('SELECT data FROM repository_changes').all();
  assert.equal(hasSecret(persisted), false);
});

test('Media denied administrator or rejected identity never writes the remote table or claims a saved draft', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  const route = `/repository-changes/${prepared.data.change.id}/save-draft`;
  f.controls.admin = false;
  const denied = await f.api(route, 'POST');
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /administrator/i);
  assert.equal(hasSecret(denied.data), false);
  assert.equal(f.inserts.length, 0);
  f.controls.identityAccepted = false;
  const unauthenticated = await f.api(route, 'POST');
  assert.equal(unauthenticated.status, 400);
  assert.equal(hasSecret(unauthenticated.data), false);
  assert.equal(f.inserts.length, 0);
  assert.equal(f.rows.size, 0);
  const registry = await f.api('/repositories');
  const change = registry.data.changes.find((item: { id: string }) => item.id === prepared.data.change.id);
  assert.equal(change.remoteDraftSavedAt, undefined);
});

test('Media remote errors expose no secrets and do not mark the artifact saved or local post published', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  const route = `/repository-changes/${prepared.data.change.id}/save-draft`;
  f.controls.tableStatus = 503;
  const rejected = await f.api(route, 'POST');
  assert.equal(rejected.status, 400);
  assert.equal(hasSecret(rejected.data), false);
  f.controls.throwTable = true;
  const network = await f.api(route, 'POST');
  assert.equal(network.status, 400);
  assert.match(network.data.error, /same draft ID/i);
  assert.equal(hasSecret(network.data), false);
  assert.equal(f.rows.size, 0);
  assert.ok(f.inserts.every(insert => insert.id === JSON.parse(prepared.data.preview).id));
  const registry = await f.api('/repositories');
  assert.equal(registry.data.changes[0].remoteDraftSavedAt, undefined);
  assert.deepEqual((await f.api('/state')).data.publications, []);
});

test('Trgovina without an administrator, unsupported artifacts and unknown IDs are rejected before outbound writes', async t => {
  const f = await fixture(t);
  const trgovina = await f.addRepository('trgovina', 'juresavron/trgovina');
  await writeFile(join(trgovina.root, 'wrangler.jsonc'), JSON.stringify({ vars: { SUPABASE_URL: 'https://cybwzhgretztcjfdefoy.supabase.co', SUPABASE_ANON_KEY: 'trgovina-public-fixture-key' } }));
  const post = await f.createDraft();
  const prepared = await f.api('/repositories/trgovina/prepare', 'POST', { postId: post.id, targetKey: 'bazen', expectedHead: trgovina.head, metadata: {} });
  assert.equal(prepared.status, 201);
  const rejected = await f.api(`/repository-changes/${prepared.data.change.id}/save-draft`, 'POST');
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /administrator account/i);
  const change = f.store.repositoryChange(prepared.data.change.id)!;
  f.store.putRepositoryChange({ ...change, id: 'unsupported-artifact', repositoryId: 'lumina', format: 'git-patch' });
  const unsupported = await f.api('/repository-changes/unsupported-artifact/save-draft', 'POST');
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.data.error, /external admin workflow/i);
  assert.equal((await f.api('/repository-changes/missing/save-draft', 'POST')).status, 404);
  assert.equal(f.requests.length, 0);
  assert.equal(f.rows.size, 0);
});

test('Media reserved static guide slugs are rejected before preparing a database payload', async t => {
  const f = await fixture(t);
  const post = await f.createDraft({ slug: 'first-freight-shipment-checklist' });
  const prepared = await f.prepare(post.id, 'sl');
  assert.equal(prepared.status, 400);
  assert.match(prepared.data.error, /reserved/i);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
  assert.equal(f.requests.length, 0);
});


test('a newly added static guide after preparation prevents remote saving even when Git HEAD stays unchanged', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 201);
  await writeFile(join(f.root, 'src/data/logisticsGuides.ts'), `export const logisticsGuides = [{ slug: ${JSON.stringify(draft.slug)} }];\n`);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  const saved = await f.api(`/repository-changes/${prepared.data.change.id}/save-draft`, 'POST');
  assert.equal(saved.status, 400);
  assert.match(saved.data.error, /reserved.*current|current.*reserved/i);
  assert.equal(f.requests.length, 0);
  assert.equal(f.rows.size, 0);
  assert.equal((await f.api('/repositories')).data.changes[0].remoteDraftSavedAt, undefined);
});

test('a current static guide summary blocks preparation beyond the adapter snapshot', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'src/data/logisticsGuideSummaries.ts'), `export const guideSummaries = [{ slug: ${JSON.stringify(draft.slug)} }];\n`);
  const post = await f.createDraft();
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 400);
  assert.match(prepared.data.error, /reserved/i);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
  assert.equal(f.requests.length, 0);
});

test('missing or symlinked static catalogs fail closed before a remote draft save', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 201);
  const catalog = join(f.root, 'src/data/logisticsGuides.ts');
  await unlink(catalog);
  const missing = await f.api(`/repository-changes/${prepared.data.change.id}/save-draft`, 'POST');
  assert.equal(missing.status, 400);
  assert.equal(f.requests.length, 0);
  const external = join(f.root, '..', 'external-catalog.ts');
  await writeFile(external, 'export const logisticsGuides = [];\n');
  await symlink(external, catalog);
  const linked = await f.api(`/repository-changes/${prepared.data.change.id}/save-draft`, 'POST');
  assert.equal(linked.status, 400);
  assert.match(linked.data.error, /regular source file/i);
  assert.equal(f.requests.length, 0);
  assert.equal(f.rows.size, 0);
});

