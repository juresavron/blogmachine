import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createStore } from '../store.js';
import { createApplication } from '../application.js';
import { createRepositorySources, gitBlobHash, sourcePaths, validateSourceSnapshot } from './snapshots.js';
import { gitIdentity, localRepositoryRoot, RepositoryCheckoutUnavailableError } from './catalog.js';
import { GitHubSourceError } from './github-source.js';
import { logistiscworldAdapter } from './logistiscworld.js';

async function fixture() {
  const content = await readFile(new URL('./fixtures/logistics-blog.ts', import.meta.url), 'utf8');
  return { version: 1 as const, repository: 'juresavron/logistiscworld', head: 'a'.repeat(40), branch: 'main', files: [{ path: 'src/data/blog.ts', content, sha: gitBlobHash(content) }], assets: [] };
}
test('source snapshots survive workspace restart and do not require Git or sibling checkouts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-test-'));
  const db = join(directory, 'workspace.sqlite');
  const original = createStore(db, false);
  const source = await fixture();
  await createRepositorySources(original, join(directory, 'missing')).import('logistiscworld', source);
  original.close();
  const restored = createStore(db, false);
  try {
    const manager = createRepositorySources(restored, join(directory, 'missing'));
    const root = await manager.root('logistiscworld');
    assert.deepEqual(await gitIdentity(root), { head: source.head, branch: 'main', sourceMode: 'snapshot' });
    assert.equal((await logistiscworldAdapter.list(root, 'main')).length, 3);
    const update = await logistiscworldAdapter.prepare(root, 'main', { title: 'New freight guide', slug: 'new-freight-guide', excerpt: 'A useful freight guide.', content: '## Start here\n\nReview the shipment details.' }, { category: 'Ocean freight', artwork: 'containers', publishedAt: '2026-11-25', takeaway: 'Check your route.' });
    assert.match(update.after, /new-freight-guide/);
    assert.equal(await readFile(join(root, source.files[0].path), 'utf8'), source.files[0].content);
  } finally { restored.close(); }
});
test('source import refuses unrelated files, path traversal, duplicate files, invalid hashes and wrong identities', async () => {
  const valid = await fixture();
  for (const input of [
    { ...valid, repository: 'juresavron/onlyworld' },
    { ...valid, files: [{ ...valid.files[0], path: '../../secret' }] },
    { ...valid, files: [...valid.files, valid.files[0]] },
    { ...valid, files: [{ ...valid.files[0], sha: '0'.repeat(40) }] },
    { ...valid, assets: [{ path: '.env', sha: '0'.repeat(40), size: 10 }] },
  ]) assert.throws(() => validateSourceSnapshot('logistiscworld', input));
});
test('invalid source syntax never replaces a working saved snapshot', async () => {
  const store = createStore(':memory:', false);
  try {
    const manager = createRepositorySources(store, '/nonexistent-blogmachine-sources');
    const valid = await fixture(); await manager.import('logistiscworld', valid);
    const content = 'export const blogPosts = [broken';
    await assert.rejects(manager.import('logistiscworld', { ...valid, files: [{ ...valid.files[0], content, sha: gitBlobHash(content) }] }));
    assert.equal(store.repositorySource('logistiscworld')?.files[0].content, valid.files[0].content);
  } finally { store.close(); }
});
test('HTTP source import exposes metadata and content remains usable after app restart', async () => {
  const store = createStore(':memory:', false);
  const source = await fixture();
  const { app } = createApplication({ store, repositoriesWorkspace: '/nonexistent-blogmachine-sources' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/repositories/logistiscworld/source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source) });
    assert.equal(response.status, 201); assert.equal('files' in await response.json(), false);
    const catalog = await (await fetch(`${origin}/api/repositories`)).json() as { repositories: { id: string; available: boolean; source?: string }[] };
    assert.equal(catalog.repositories.find(item => item.id === 'logistiscworld')?.source, 'snapshot');
    const articles = await (await fetch(`${origin}/api/repositories/logistiscworld/articles?target=main`)).json() as { articles: unknown[] };
    assert.equal(articles.articles.length, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});


async function localCheckout(workspace: string, directory = 'logistiscworld', remote = 'https://github.com/juresavron/logistiscworld.git') {
  const root = join(workspace, directory);
  await mkdir(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Source fixture', '-c', 'user.email=fixture@example.test', '-C', root, ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '--initial-branch=main'); git('remote', 'add', 'origin', remote);
  const source = await fixture();
  await mkdir(dirname(join(root, source.files[0].path)), { recursive: true });
  await writeFile(join(root, source.files[0].path), source.files[0].content);
  git('add', '.'); git('commit', '-m', 'Source fixture');
  return { root, head: git('rev-parse', 'HEAD') };
}
function savedOcenaSource() {
  return {
    version: 1 as const, id: 'ocenagor', repository: 'juresavron/ocenagor-landing-lovable-13', head: 'a'.repeat(40), branch: 'main', importedAt: '2026-11-25T12:00:00.000Z', assets: [],
    files: sourcePaths('ocenagor').map(path => { const content = `// Provider fixture for ${path}\n`; return { path, content, sha: gitBlobHash(content) }; }),
  };
}

test('a verified local checkout takes precedence over a saved source snapshot', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'source-precedence-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const local = await localCheckout(workspace);
  const store = createStore(':memory:', false); t.after(() => store.close());
  const saved = { ...await fixture(), id: 'logistiscworld', importedAt: '2026-11-25T12:00:00.000Z' };
  store.putRepositorySource(saved);
  let reads = 0, requests = 0;
  const provider = { ...store, repositorySource: (id: string) => { reads++; return store.repositorySource(id); } };
  const manager = createRepositorySources(provider, workspace, { env: {}, request: async () => { requests++; throw new Error('No remote source expected.'); } });
  assert.equal(await manager.root('logistiscworld'), local.root);
  assert.deepEqual(await gitIdentity(local.root), { head: local.head, branch: 'main', sourceMode: 'local' });
  assert.equal(reads, 0); assert.equal(requests, 0);
});

test('a validated saved OcenaGor snapshot is preferred over hosted GitHub source when local source is absent', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'source-saved-first-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = createStore(':memory:', false); t.after(() => store.close());
  const saved = savedOcenaSource(); store.putRepositorySource(saved);
  let requests = 0;
  const manager = createRepositorySources(store, workspace, { env: {}, request: async () => { requests++; throw new Error('Saved source must precede remote access.'); } });
  const root = await manager.root('ocenagor');
  assert.deepEqual(await gitIdentity(root), { head: saved.head, branch: 'main', sourceMode: 'snapshot' });
  assert.equal(requests, 0);
  assert.equal(await readFile(join(root, saved.files[0].path), 'utf8'), saved.files[0].content);
});

test('an invalid saved source remains an error and cannot be bypassed with GitHub fallback', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'source-saved-invalid-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = createStore(':memory:', false); t.after(() => store.close());
  const saved = savedOcenaSource(); saved.files[0].sha = '0'.repeat(40); store.putRepositorySource(saved);
  let requests = 0;
  const manager = createRepositorySources(store, workspace, { env: {}, request: async () => { requests++; throw new Error('Invalid saved source must stay visible.'); } });
  await assert.rejects(manager.root('ocenagor'), /Git integrity check/);
  assert.equal(requests, 0);
});

test('bad checkout origins, non-Git directories and symlinks cannot fall back to saved snapshots', async t => {
  for (const kind of ['wrong-origin', 'not-git', 'symlink', 'dangling-symlink', 'file'] as const) {
    await t.test(kind, async subtest => {
      const workspace = await mkdtemp(join(tmpdir(), 'source-invalid-checkout-'));
      subtest.after(() => rm(workspace, { recursive: true, force: true }));
      const store = createStore(':memory:', false); subtest.after(() => store.close());
      store.putRepositorySource({ ...await fixture(), id: 'logistiscworld', importedAt: '2026-11-25T12:00:00.000Z' });
      const destination = join(workspace, 'logistiscworld');
      if (kind === 'wrong-origin') await localCheckout(workspace, 'logistiscworld', 'https://github.com/example/wrong-site.git');
      if (kind === 'not-git') await mkdir(destination);
      if (kind === 'file') await writeFile(destination, 'not a checkout');
      if (kind === 'symlink') { await mkdir(join(workspace, 'outside')); await symlink(join(workspace, 'outside'), destination); }
      if (kind === 'dangling-symlink') await symlink(join(workspace, 'absent-target'), destination);
      let reads = 0;
      const manager = createRepositorySources({ ...store, repositorySource: (id: string) => { reads++; return store.repositorySource(id); } }, workspace, { env: {} });
      await assert.rejects(manager.root('logistiscworld'), error => !(error instanceof RepositoryCheckoutUnavailableError));
      assert.equal(reads, 0, 'Invalid local source is refused before consulting saved snapshots.');
    });
  }
});

test('only absent local source emits the typed missing-checkout condition and hosted failures remain visible', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'source-typed-missing-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await assert.rejects(localRepositoryRoot(workspace, 'ocenagor'), error => error instanceof RepositoryCheckoutUnavailableError);
  const store = createStore(':memory:', false); t.after(() => store.close());
  await assert.rejects(createRepositorySources(store, workspace, { env: {} }).root('ocenagor'), error => error instanceof GitHubSourceError && error.code === 'token_missing');
  let reads = 0, requests = 0;
  const saved = savedOcenaSource();
  const provider = { ...store, repositorySource: () => { reads++; return reads === 1 ? undefined : saved; } };
  const manager = createRepositorySources(provider, workspace, { env: { BLOGMACHINE_GITHUB_TOKEN: 'fixture-read-token' }, request: async () => { requests++; return new Response('{}', { status: 403 }); } });
  await assert.rejects(manager.root('ocenagor'), error => error instanceof GitHubSourceError && error.code === 'forbidden');
  assert.equal(reads, 1, 'An upstream failure must not trigger a second lookup/fallback to a saved source.');
  assert.equal(requests, 1);
});

test('the local export command emits the strict source snapshot shape without source-mode identity fields', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'source-export-command-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const local = await localCheckout(workspace);
  const output = join(workspace, 'export.json');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/export-source.ts', '--id', 'logistiscworld', '--workspace', workspace, '--output', output], { cwd: process.cwd(), stdio: 'pipe' });
  const exported = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(exported.head, local.head); assert.equal(exported.branch, 'main');
  assert.equal('sourceMode' in exported, false);
  assert.deepEqual(Object.keys(exported).sort(), ['assets', 'branch', 'files', 'head', 'repository', 'version']);
  assert.equal(validateSourceSnapshot('logistiscworld', exported).head, local.head);
});
