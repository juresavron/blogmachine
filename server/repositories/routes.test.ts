import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.js';

const contentPath = 'src/data/guides.ts';
const original = `// Existing introduction stays intact.\nexport interface Guide { slug: string; title: string; description: string; excerpt: string; sections: { heading: string; body: string }[]; }\nexport const guides: Guide[] = [\n  { slug: 'existing-guide', title: 'Existing guide', description: 'An existing description.', excerpt: 'An existing excerpt.', sections: [{ heading: 'The original section', body: 'Existing content.' }] }\n];\n// Existing footer stays intact.\n`;
const draft = { title: 'A new guide', slug: 'a-new-guide', excerpt: 'A useful guide to the next step.', content: '## First step\n\nSome useful instructions.\n\n## Second step\n\nCheck the result.' };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture(t: TestContext) {
  const temp = await mkdtemp(join(tmpdir(), 'blogmachine-repository-api-'));
  const workspace = join(temp, 'workspace');
  const root = join(workspace, 'lumina');
  const file = join(root, contentPath);
  await mkdir(join(root, 'src/data'), { recursive: true });
  await writeFile(file, original);
  // Every Git mutation in this test is confined to this fresh temporary repository.
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Blog Machine Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/juresavron/lumina.git');
  git('add', contentPath);
  git('commit', '-m', 'Create isolated content fixture');
  const head = git('rev-parse', 'HEAD');
  const databasePath = join(temp, 'blogmachine.sqlite');
  const { app, store } = createApp({ databasePath, seed: false, env: {}, repositoriesWorkspace: workspace });
  const server: Server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port.');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    await rm(temp, { recursive: true, force: true });
  });
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  async function createDraft(input: Partial<typeof draft> = {}) {
    const result = await api('/posts', 'POST', { ...draft, ...input });
    assert.equal(result.status, 201);
    return result.data as typeof draft & { id: string };
  }
  const prepare = (postId: string, overrides: Record<string, unknown> = {}) => api('/repositories/lumina/prepare', 'POST', { postId, targetKey: 'main', expectedHead: head, expectedSourceHash: sha(original), metadata: {}, ...overrides });
  return { temp, root, file, head, base, store, api, git, createDraft, prepare, databasePath };
}

test('repository registry describes available source separately from empty placeholders and live access', async t => {
  const f = await fixture(t);
  const result = await f.api('/repositories');
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.data.repositories));
  const lumina = result.data.repositories.find((item: { id: string }) => item.id === 'lumina');
  assert.equal(lumina.available, true);
  assert.equal(lumina.branch, 'main');
  assert.equal(lumina.head, f.head);
  assert.match(lumina.message, /not verified/i);
  const empty = result.data.repositories.filter((item: { kind: string }) => item.kind === 'empty');
  assert.ok(empty.length > 0);
  for (const item of empty) { assert.equal(item.available, false); assert.deepEqual(item.targets, []); }
  assert.deepEqual(result.data.changes, []);
});

test('repository article reads return actual content hash and read-only connection identity', async t => {
  const f = await fixture(t);
  const result = await f.api('/repositories/lumina/articles?target=main');
  assert.equal(result.status, 200);
  assert.equal(result.data.sourceHash, sha(original));
  assert.deepEqual(result.data.articles, [{ slug: 'existing-guide', title: 'Existing guide', description: 'An existing description.', url: 'https://pergola-lumina.si/nasveti/existing-guide' }]);
  const connection = await f.api('/repositories/lumina/test-connection', 'POST');
  assert.equal(connection.status, 200);
  assert.equal(connection.data.readable, true);
  assert.equal(connection.data.head, f.head);
  assert.match(connection.data.message, /does not verify/i);
  assert.equal(await readFile(f.file, 'utf8'), original);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('repository preparation persists a downloadable applicable patch without changing source or publication records', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  const prepared = await f.prepare(post.id);
  assert.equal(prepared.status, 201);
  const { change, preview } = prepared.data;
  assert.equal(change.status, 'prepared');
  assert.equal(change.format, 'git-patch');
  assert.equal(change.relativePath, contentPath);
  assert.equal(change.baseHead, f.head);
  assert.equal(change.sourceHash, sha(original));
  assert.equal(change.articleUrl, 'https://pergola-lumina.si/nasveti/a-new-guide');
  assert.equal(change.artifact, undefined);
  assert.match(preview, /a\/src\/data\/guides\.ts/);
  assert.match(preview, /A new guide/);
  const download = await fetch(`${f.base}${change.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /attachment;.*\.patch/);
  assert.equal(await download.text(), preview);
  // git apply --check reads this exact downloaded artifact but never applies it.
  execFileSync('git', ['-C', f.root, 'apply', '--check', '-'], { input: preview, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(await readFile(f.file, 'utf8'), original);
  assert.equal(f.git('status', '--porcelain'), '');
  const state = await f.api('/state');
  assert.deepEqual(state.data.publications, []);
  assert.equal(state.data.posts.find((item: { id: string }) => item.id === post.id).status, 'draft');
  const registry = await f.api('/repositories');
  assert.equal(registry.data.changes.length, 1);
  assert.equal(registry.data.changes[0].id, change.id);
  assert.equal(registry.data.changes[0].artifact, undefined);
  const reopened = new DatabaseSync(f.databasePath);
  try {
    const row = reopened.prepare('SELECT data FROM repository_changes WHERE id = ?').get(change.id) as { data: string };
    assert.equal(JSON.parse(row.data).artifact, preview);
  } finally { reopened.close(); }
});

test('repository preparation rejects missing or stale source hashes and stale HEAD without creating artifacts', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  for (const overrides of [{ expectedHead: '0'.repeat(40) }, { expectedSourceHash: '0'.repeat(64) }, { expectedSourceHash: undefined }]) {
    assert.equal((await f.prepare(post.id, overrides)).status, 409);
  }
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
  assert.equal(await readFile(f.file, 'utf8'), original);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('actual repository or content changes after article loading invalidate preparation', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  await writeFile(f.file, original + '// A newer local edit.\n');
  assert.equal((await f.prepare(post.id)).status, 409);
  assert.equal(await readFile(f.file, 'utf8'), original + '// A newer local edit.\n');
  await writeFile(f.file, original);
  f.git('commit', '--allow-empty', '-m', 'Advance isolated fixture HEAD');
  assert.notEqual(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal((await f.prepare(post.id)).status, 409);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
});

test('unknown repository IDs, traversal-shaped targets, missing posts, and missing artifacts are rejected', async t => {
  const f = await fixture(t);
  const post = await f.createDraft();
  assert.equal((await f.api('/repositories/unknown/articles?target=main')).status, 400);
  assert.equal((await f.api('/repositories/%2E%2E%2Flumina/articles?target=main')).status, 400);
  assert.equal((await f.api('/repositories/lumina/articles?target=..%2Fmain')).status, 400);
  assert.equal((await f.prepare(post.id, { targetKey: '../../lumina' })).status, 400);
  assert.equal((await f.prepare('missing-post')).status, 404);
  assert.equal((await f.api('/repository-changes/missing/download')).status, 404);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
});

test('repository preparation gives plain errors for missing descriptions and rejects HTML-sensitive content and metadata', async t => {
  const f = await fixture(t);
  const withoutExcerpt = await f.createDraft({ excerpt: '' });
  const missing = await f.prepare(withoutExcerpt.id);
  assert.equal(missing.status, 400);
  assert.equal(typeof missing.data.error, 'string');
  assert.ok(missing.data.error.length > 5);
  assert.equal(missing.data.stack, undefined);
  const unsafe = await f.createDraft({ content: '<script>alert(1)</script>' });
  const rejected = await f.prepare(unsafe.id);
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /plain text/i);
  const safe = await f.createDraft();
  const metadata = await f.prepare(safe.id, { metadata: { nested: { text: '<script>' } } });
  assert.equal(metadata.status, 400);
  assert.match(metadata.data.error, /plain.text/i);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
  assert.equal(await readFile(f.file, 'utf8'), original);
});

test('symlinked content is refused and the external file stays untouched', async t => {
  const f = await fixture(t);
  const external = join(f.temp, 'external-guides.ts');
  await writeFile(external, original);
  await unlink(f.file);
  await symlink(external, f.file);
  const post = await f.createDraft();
  assert.equal((await f.api('/repositories/lumina/articles?target=main')).status, 409);
  assert.equal((await f.prepare(post.id)).status, 409);
  assert.equal(await readFile(external, 'utf8'), original);
  assert.equal((await f.api('/repositories')).data.changes.length, 0);
});
