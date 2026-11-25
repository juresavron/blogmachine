import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createPostgresStore } from './postgres-store.js';
import { createStore } from './store.js';
import type { PreparedChange } from './repositories/routes.js';
import type { Post, Publication, Site } from './types.js';

const connectionString = process.env.TEST_POSTGRES_URL;
const requiresDatabase = { skip: connectionString ? false : 'Set TEST_POSTGRES_URL to run against an isolated PostgreSQL database.' };
const timestamp = '2026-11-25T12:00:00.000Z';
const site = (id: string): Site => ({ id, name: id, url: `https://${id}.example`, platform: 'demo', searchConsoleProperty: '', credentialKey: id.toUpperCase(), createdAt: timestamp });
const post = (id: string, siteIds: string[] = []): Post => ({ id, title: id, slug: id, excerpt: 'Description', content: 'Content', status: 'draft', siteIds, createdAt: timestamp, updatedAt: timestamp });
const publication = (id: string, postId: string, siteId: string): Publication => ({ id, postId, siteId, url: `https://${siteId}.example/${postId}`, status: 'published', mode: 'demo', error: null, publishedAt: timestamp, indexingStatus: 'not_inspected', lastInspectedAt: null });
const prepared = (id: string): PreparedChange => ({ id, repositoryId: 'lumina', targetKey: 'sl', postId: 'post', postTitle: 'Post', format: 'git-patch', relativePath: 'src/data/guides.ts', articleUrl: 'https://pergola-lumina.si/nasveti/post', baseHead: 'a'.repeat(40), sourceHash: 'b'.repeat(64), createdAt: timestamp, status: 'prepared', instructions: 'Review before applying.', warnings: [], artifact: 'A prepared patch\n' });

async function fixture(t: TestContext) {
  const admin = new pg.Pool({ connectionString, max: 2 });
  const schema = `blogmachine_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pools: pg.Pool[] = [];
  t.after(async () => {
    await Promise.all(pools.map(pool => pool.end().catch(() => {})));
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  function pool() {
    const value = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 5 });
    pools.push(value);
    return value;
  }
  return { pool };
}

test('SQLite prepared changes persist through the shared store methods and publication identities stay consistent', () => {
  const store = createStore(':memory:', false);
  try {
    const first = prepared('first'), second = prepared('second');
    store.putRepositoryChange(first); store.putRepositoryChange(second);
    store.putRepositoryChange({ ...first, remoteDraftSavedAt: timestamp });
    assert.deepEqual(store.repositoryChanges().map(change => change.id), ['second', 'first']);
    assert.equal(store.repositoryChange('first')?.remoteDraftSavedAt, timestamp);
    assert.equal(store.repositoryChange('missing'), undefined);
    store.putPublication(publication('old', 'post', 'site'));
    store.putPublication(publication('replacement', 'post', 'site'));
    assert.equal(store.publications().length, 1);
    assert.equal(store.publication('old'), undefined);
    assert.equal(store.publication('replacement')?.id, 'replacement');
  } finally { store.close(); }
});

test('Postgres persists content and prepared changes across store restarts with stable insertion ordering', requiresDatabase, async t => {
  const f = await fixture(t);
  const first = await createPostgresStore(f.pool(), false);
  await first.putSite(site('first'));
  await first.putSite(site('second'));
  await first.putPost(post('post', ['first']));
  await first.putPublication(publication('publication', 'post', 'first'));
  await first.putRepositoryChange(prepared('change-first'));
  await first.putRepositoryChange(prepared('change-second'));
  await first.putSite({ ...site('first'), name: 'Updated first' });
  await first.putRepositoryChange({ ...prepared('change-first'), remoteDraftSavedAt: timestamp });
  await first.close();
  const restored = await createPostgresStore(f.pool(), false);
  assert.deepEqual((await restored.sites()).map(value => value.id), ['first', 'second']);
  assert.equal((await restored.site('first'))?.name, 'Updated first');
  assert.equal((await restored.post('post'))?.content, 'Content');
  assert.equal((await restored.publication('publication'))?.siteId, 'first');
  assert.deepEqual((await restored.repositoryChanges()).map(value => value.id), ['change-second', 'change-first']);
  assert.equal((await restored.repositoryChange('change-first'))?.remoteDraftSavedAt, timestamp);
  assert.equal(await restored.post('missing'), undefined);
  assert.equal(await restored.site('missing'), undefined);
  assert.equal(await restored.publication('missing'), undefined);
  assert.equal(await restored.repositoryChange('missing'), undefined);
});

test('Postgres enforces publication uniqueness while allowing a publication update to retain insertion order', requiresDatabase, async t => {
  const f = await fixture(t);
  const store = await createPostgresStore(f.pool(), false);
  await store.putPublication(publication('old', 'post-a', 'site'));
  await store.putPublication(publication('other', 'post-b', 'site'));
  await store.putPublication({ ...publication('replacement', 'post-a', 'site'), url: 'https://site.example/revised', indexingStatus: 'indexed' });
  assert.equal((await store.publications()).length, 2);
  assert.deepEqual((await store.publications()).map(value => value.id), ['replacement', 'other']);
  assert.equal(await store.publication('old'), undefined);
  assert.equal((await store.publication('replacement'))?.indexingStatus, 'indexed');
});

test('Postgres removes related publications transactionally and keeps remaining post website/status data', requiresDatabase, async t => {
  const f = await fixture(t);
  const store = await createPostgresStore(f.pool(), false);
  for (const id of ['first', 'second']) await store.putSite(site(id));
  await store.putPost({ ...post('shared', ['first', 'second']), status: 'published' });
  await store.putPost({ ...post('only-first', ['first']), status: 'published' });
  await store.putPublication(publication('shared-first', 'shared', 'first'));
  await store.putPublication(publication('shared-second', 'shared', 'second'));
  await store.putPublication(publication('only-first', 'only-first', 'first'));
  await store.putRepositoryChange(prepared('review-artifact'));
  await store.deleteSite('first');
  assert.equal(await store.site('first'), undefined);
  assert.deepEqual((await store.post('shared'))?.siteIds, ['second']);
  assert.equal((await store.post('shared'))?.status, 'published');
  assert.deepEqual((await store.post('only-first'))?.siteIds, []);
  assert.equal((await store.post('only-first'))?.status, 'draft');
  assert.deepEqual((await store.publications()).map(value => value.id), ['shared-second']);
  await store.deletePost('shared');
  assert.equal(await store.post('shared'), undefined);
  assert.deepEqual(await store.publications(), []);
  assert.equal((await store.repositoryChanges()).length, 1, 'Review artifacts are retained independently of post deletion.');
});

test('Postgres rolls back a failed deletion instead of keeping partial changes', requiresDatabase, async t => {
  const f = await fixture(t);
  const pool = f.pool();
  const store = await createPostgresStore(pool, false);
  await store.putPost(post('post'));
  await store.putPublication(publication('publication', 'post', 'site'));
  await pool.query(`CREATE FUNCTION reject_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test deletion rejected'; END; $$;
    CREATE TRIGGER reject_test_delete BEFORE DELETE ON blogmachine_posts FOR EACH ROW EXECUTE FUNCTION reject_test_delete();`);
  await assert.rejects(store.deletePost('post'), /test deletion rejected/);
  assert.equal((await store.publications()).length, 1, 'Publication deletion rolls back with the failed post deletion.');
  assert.equal((await store.post('post'))?.id, 'post');
});

test('Postgres serializes concurrent startup and seeds once without replacing edits or reseeding deleted data', requiresDatabase, async t => {
  const f = await fixture(t);
  const stores = await Promise.all(Array.from({ length: 4 }, () => createPostgresStore(f.pool())));
  const store = stores[0];
  assert.equal((await store.sites()).length, 3);
  assert.equal((await store.posts()).length, 3);
  assert.equal((await store.publications()).length, 2);
  const original = (await store.posts())[0];
  await store.putPost({ ...original, title: 'A retained edit' });
  await createPostgresStore(f.pool());
  assert.equal((await store.post(original.id))?.title, 'A retained edit');
  for (const item of await store.posts()) await store.deletePost(item.id);
  for (const item of await store.sites()) await store.deleteSite(item.id);
  await createPostgresStore(f.pool());
  assert.deepEqual(await store.posts(), []);
  assert.deepEqual(await store.sites(), []);
});

test('Postgres request write locks contend across store instances and release idempotently', requiresDatabase, async t => {
  const f = await fixture(t);
  const first = await createPostgresStore(f.pool(), false);
  const second = await createPostgresStore(f.pool(), false);
  const releaseFirst = await first.acquireWriteLock();
  assert(releaseFirst);
  try {
    assert.equal(await second.acquireWriteLock(), null);
    await first.putPost(post('while-locked'));
    assert.equal((await second.post('while-locked'))?.id, 'while-locked', 'Ordinary queries use a separate connection while the request holds the lock.');
  } finally { await releaseFirst(); }
  await releaseFirst();
  const releaseSecond = await second.acquireWriteLock();
  assert(releaseSecond);
  await Promise.all([releaseSecond(), releaseSecond()]);
  const afterRelease = await first.acquireWriteLock();
  assert(afterRelease);
  await afterRelease();
});

test('Postgres store close releases an outstanding request lock before ending the pool', requiresDatabase, async t => {
  const f = await fixture(t);
  const first = await createPostgresStore(f.pool(), false);
  const second = await createPostgresStore(f.pool(), false);
  const release = await first.acquireWriteLock();
  assert(release);
  await first.close();
  await release();
  const next = await second.acquireWriteLock();
  assert(next);
  await next();
});

test('Netlify initial migration prepares a schema compatible with runtime startup and seeding', requiresDatabase, async t => {
  const f = await fixture(t);
  const pool = f.pool();
  const migration = await readFile(new URL('../netlify/database/migrations/0001_create_blogmachine.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  const store = await createPostgresStore(pool);
  assert.equal((await store.posts()).length, 3);
  await store.putRepositoryChange(prepared('change'));
  assert.equal((await store.repositoryChange('change'))?.artifact, 'A prepared patch\n');
});
