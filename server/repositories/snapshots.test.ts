import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../store.js';
import { createApplication } from '../application.js';
import { createRepositorySources, gitBlobHash, validateSourceSnapshot } from './snapshots.js';
import { gitIdentity } from './catalog.js';
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
    assert.deepEqual(await gitIdentity(root), { head: source.head, branch: 'main' });
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
