import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createStore } from './store.js';
import { createNetlifyApp, validNetlifyUser } from './netlify-app.js';
import type { NetlifyStorage } from './netlify-app.js';

async function fixture(t: test.TestContext, options: { authenticated?: boolean; storage?: (store: NetlifyStorage) => NetlifyStorage } = {}) {
  const sqlite = createStore(':memory:', false);
  let locked = false;
  let releases = 0;
  const baseStore: NetlifyStorage = { ...sqlite, async acquireWriteLock() {
    if (locked) return null;
    locked = true;
    let released = false;
    return async () => { if (!released) { released = true; locked = false; releases++; } };
  } };
  const store = options.storage?.(baseStore) ?? baseStore;
  const workspace = createNetlifyApp(store, () => options.authenticated ?? true);
  const server = workspace.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await workspace.shutdown(); });
  return { url, workspace, sqlite, releases: () => releases };
}
function gate() {
  let release!: () => void;
  let entered!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), started: new Promise<void>(resolve => { entered = resolve; }), release: () => release(), entered: () => entered() };
}
const post = (url: string, title: string) => fetch(`${url}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });

 test('Netlify identity must be present, signed by the platform, and unexpired', async t => {
  assert.equal(validNetlifyUser(undefined), false);
  assert.equal(validNetlifyUser({ id: 'owner', expiresAt: new Date(Date.now() - 1) }), false);
  assert.equal(validNetlifyUser({ id: 'owner', expiresAt: new Date('invalid') }), false);
  assert.equal(validNetlifyUser({ id: 'owner', expiresAt: new Date(Date.now() + 60000) }), true);
  const f = await fixture(t, { authenticated: false });
  for (const path of ['/api/health', '/api/state']) {
    const response = await fetch(f.url + path, { headers: { 'x-netlify-user': 'owner', 'x-nf-identity': 'owner' } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await post(f.url, 'Anonymous write')).status, 401);
  assert.equal(f.sqlite.posts().length, 0);
  assert.equal(f.releases(), 0);
});

test('authenticated requests read state and serialise competing mutations', async t => {
  const pending = gate();
  const f = await fixture(t, { storage: store => ({ ...store, async putPost(value) { if (value.title === 'First') { pending.entered(); await pending.promise; } await store.putPost(value); } }) });
  assert.equal((await fetch(`${f.url}/api/health`)).status, 200);
  const first = post(f.url, 'First'); await pending.started;
  assert.equal((await post(f.url, 'Second')).status, 409);
  // Reads remain available while a mutating handler is waiting.
  assert.equal((await fetch(`${f.url}/api/state`)).status, 200);
  pending.release(); assert.equal((await first).status, 201);
  assert.equal((await post(f.url, 'Second')).status, 201);
  assert.equal(f.sqlite.posts().length, 2);
  assert.equal(f.releases(), 2);
});

test('client disconnect does not release a write lock before its handler finishes', async t => {
  const pending = gate();
  const f = await fixture(t, { storage: store => ({ ...store, async putPost(value) { if (value.title === 'Disconnected') { pending.entered(); await pending.promise; } await store.putPost(value); } }) });
  const req = request(`${f.url}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.end(JSON.stringify({ title: 'Disconnected' }));
  await pending.started; req.destroy();
  assert.equal((await post(f.url, 'Competing write')).status, 409);
  assert.equal(f.releases(), 0);
  pending.release();
  for (let i = 0; i < 100 && f.releases() === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.releases(), 1);
  assert.equal((await post(f.url, 'After disconnect')).status, 201);
  assert.equal(f.sqlite.posts().length, 2);
});

test('shutdown drains active storage work before closing the database', async t => {
  const pending = gate();
  let closed = false;
  const f = await fixture(t, { storage: store => ({ ...store, async putPost(value) { pending.entered(); await pending.promise; await store.putPost(value); }, close() { closed = true; return store.close(); } }) });
  const active = post(f.url, 'Last write'); await pending.started;
  const shutdown = f.workspace.shutdown();
  assert.equal(closed, false);
  assert.equal((await fetch(`${f.url}/api/state`)).status, 503);
  pending.release(); assert.equal((await active).status, 201);
  await shutdown; assert.equal(closed, true);
  assert.equal(f.releases(), 1);
});

test('database lock errors are private and do not enter the API handler', async t => {
  const f = await fixture(t, { storage: store => ({ ...store, async acquireWriteLock() { throw new Error('private database connection details'); } }) });
  const response = await post(f.url, 'Storage failure');
  assert.equal(response.status, 503);
  assert(!JSON.stringify(await response.json()).includes('private database'));
  assert.equal(f.sqlite.posts().length, 0);
});
