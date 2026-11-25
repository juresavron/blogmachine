import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Server } from 'node:http';
import { createApplication, type ApplicationOptions } from './application.js';
import { createStore } from './store.js';
import type { ContentStore } from './storage.js';
import type { PreparedChange } from './repositories/routes.js';
import type { Publication } from './types.js';
import { UnsentRequestError, type OutboundRequest } from './network.js';

// Delay both reads and writes so an omitted await cannot pass by completing in
// the same microtask turn as the HTTP response.
async function fixture(t: TestContext, options: Omit<ApplicationOptions, 'store'> = {}, overrides: Partial<ContentStore> = {}) {
  const backing = createStore(':memory:', false);
  const source: ContentStore = { ...backing, ...overrides };
  const store = new Proxy(source, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await new Promise(resolve => setTimeout(resolve, 3));
        return Reflect.apply(value, target, args);
      };
    },
  });
  const { app } = createApplication({ env: {}, ...options, store });
  const server: Server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.close();
  });
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: response.status === 204 ? undefined : await response.json() };
  }
  return { api, base, store, backing };
}

test('async storage supports validated CRUD, demo publication, and cascading removal', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.api('/state')).data.posts, []);
  const site = await f.api('/sites', 'POST', { name: 'Demo destination', url: 'https://demo.example', platform: 'demo' });
  assert.equal(site.status, 201);
  assert.equal((await f.api('/sites', 'POST', { name: 'Duplicate', url: 'https://demo.example', platform: 'demo' })).status, 409);
  const renamed = await f.api(`/sites/${site.data.id}`, 'PATCH', { name: 'Renamed demo' });
  assert.equal(renamed.data.name, 'Renamed demo');
  assert.equal((await f.api('/posts', 'POST', { title: 'Invalid destination', siteIds: ['missing'] })).status, 404);
  const created = await f.api('/posts', 'POST', { title: 'Durable draft', content: 'The writing survives a request.', siteIds: [site.data.id] });
  assert.equal(created.status, 201);
  const updated = await f.api(`/posts/${created.data.id}`, 'PATCH', { excerpt: 'A saved description.', siteIds: [site.data.id] });
  assert.equal(updated.data.excerpt, 'A saved description.');
  const first = await f.api(`/posts/${created.data.id}/publish`, 'POST', { siteIds: [site.data.id] });
  assert.equal(first.data.publications[0].status, 'published');
  assert.equal(first.data.publications[0].mode, 'demo');
  const second = await f.api(`/posts/${created.data.id}/publish`, 'POST', { siteIds: [site.data.id] });
  assert.equal(second.data.publications[0].id, first.data.publications[0].id);
  assert.equal((await f.api(`/publications/${first.data.publications[0].id}/inspect`, 'POST', {})).status, 400);
  assert.equal((await f.api(`/sites/${site.data.id}/sitemap`, 'POST', {})).status, 400);
  assert.equal((await f.api('/state')).data.publications.length, 1);
  assert.equal((await f.api(`/sites/${site.data.id}`, 'DELETE')).status, 204);
  const state = (await f.api('/state')).data;
  assert.deepEqual(state.publications, []);
  assert.deepEqual(state.posts[0].siteIds, []);
  assert.equal((await f.api(`/posts/${created.data.id}`, 'DELETE')).status, 204);
  assert.equal((await f.api(`/posts/${created.data.id}`, 'PATCH', { title: 'Gone' })).status, 404);
});

test('async storage awaits live publication and URL inspection while keeping remote IDs private', async t => {
  const sent: string[] = [];
  const f = await fixture(t, {
    env: { TEST_URL: 'https://blog.example', TEST_USERNAME: 'fixture', TEST_APPLICATION_PASSWORD: 'fixture-password', GOOGLE_ACCESS_TOKEN: 'fixture-google-token' },
    wordpressRequest: async (url, init) => {
      sent.push(`${init.method} ${url}`);
      if (url.endsWith('/users/me?context=edit')) return { ok: true, status: 200, json: async () => ({ id: 9, capabilities: { publish_posts: true } }) };
      return { ok: true, status: 201, json: async () => ({ id: 42, link: 'https://blog.example/durable-live-story/' }) };
    },
    googleRequest: async (url, init) => {
      sent.push(`${init.method} ${url}`);
      return { ok: true, status: 200, json: async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } }) };
    },
  });
  const site = (await f.api('/sites', 'POST', { name: 'Live fixture', url: 'https://blog.example', platform: 'wordpress', credentialKey: 'TEST', searchConsoleProperty: 'sc-domain:blog.example' })).data;
  assert.equal((await f.api(`/sites/${site.id}/test-connection`, 'POST', {})).data.authenticated, true);
  const post = (await f.api('/posts', 'POST', { title: 'Durable live story', content: 'Mocked outbound content.', siteIds: [site.id] })).data;
  const publication = (await f.api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] })).data.publications[0];
  assert.equal(publication.status, 'published');
  assert.equal(publication.mode, 'live');
  assert.equal(publication.remoteId, undefined);
  assert.equal((await f.store.publication(publication.id))?.remoteId, 42);
  const inspected = await f.api(`/publications/${publication.id}/inspect`, 'POST', {});
  assert.equal(inspected.data.publication.indexingStatus, 'indexed');
  assert.equal((await f.store.publication(publication.id))?.indexingStatus, 'indexed');
  const again = (await f.api(`/posts/${post.id}/publish`, 'POST', { siteIds: [site.id] })).data.publications[0];
  assert.equal(again.id, publication.id);
  assert(sent.includes('POST https://blog.example/wp-json/wp/v2/posts/42'));
  assert.equal((await f.api(`/sites/${site.id}/sitemap`, 'POST', {})).data.submitted, true);
  assert.equal((await f.api('/state')).data.publications[0].remoteId, undefined);
});

test('async repository artifacts are listed and downloaded through the storage interface', async t => {
  const f = await fixture(t);
  const prepared: PreparedChange = {
    id: 'prepared-fixture', repositoryId: 'lumina', targetKey: 'main', postId: 'post-fixture', postTitle: 'Fixture guide',
    format: 'git-patch', relativePath: 'src/data/guides.ts', articleUrl: 'https://pergola-lumina.si/nasveti/fixture/',
    baseHead: 'a'.repeat(40), sourceHash: 'b'.repeat(64), createdAt: new Date().toISOString(), status: 'prepared',
    instructions: 'Review before deployment.', warnings: [], artifact: '--- a/guides.ts\n+++ b/guides.ts\n',
  };
  await f.store.putRepositoryChange(prepared);
  const listed = (await f.api('/repositories')).data.changes;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, prepared.id);
  assert.equal(listed[0].artifact, undefined);
  const download = await fetch(f.base + listed[0].downloadUrl);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), prepared.artifact);
  assert.equal((await f.api('/repository-changes/missing/download')).status, 404);
  assert.equal((await f.api('/repository-changes/missing/save-draft', 'POST', {})).status, 404);
});

test('async storage write failures return an error instead of confirming an unsaved post', async t => {
  const f = await fixture(t, {}, { putPost: async () => { throw new Error('Storage unavailable'); } });
  const result = await f.api('/posts', 'POST', { title: 'Unsaved draft' });
  assert.equal(result.status, 500);
  assert.equal(result.data.error, 'An unexpected server error occurred.');
  assert.deepEqual((await f.api('/state')).data.posts, []);
});


test('repository storage failures do not expose database details through adapter errors', async t => {
  const internal = 'database provider detail that must remain private';
  const f = await fixture(t, {}, {
    repositoryChanges: async () => { throw new Error(internal); },
    repositoryChange: async () => { throw new Error(internal); },
  });
  for (const [path, method] of [['/repositories', 'GET'], ['/repository-changes/fixture/download', 'GET'], ['/repository-changes/fixture/save-draft', 'POST']]) {
    const response = await f.api(path, method);
    assert.equal(response.status, 503);
    assert.match(response.data.error, /storage is temporarily unavailable/);
    assert(!JSON.stringify(response.data).includes(internal));
  }
});


const wordpressEnv = { TEST_URL: 'https://blog.example', TEST_USERNAME: 'fixture', TEST_APPLICATION_PASSWORD: 'fixture-password' };
async function liveDraft(f: Awaited<ReturnType<typeof fixture>>) {
  const site = (await f.api('/sites', 'POST', { name: 'Live fixture', url: 'https://blog.example', platform: 'wordpress', credentialKey: 'TEST' })).data;
  const post = (await f.api('/posts', 'POST', { title: 'Protected creation', content: 'Mocked outbound content.' })).data;
  return { path: `/posts/${post.id}/publish`, body: { siteIds: [site.id] } };
}

test('first WordPress create never sends when its durable marker cannot be saved', async t => {
  let sends = 0;
  const f = await fixture(t, {
    env: wordpressEnv,
    wordpressRequest: async () => { sends++; throw new Error('Unexpected send'); },
  }, { putPublication: async () => { throw new Error('Private database failure'); } });
  const draft = await liveDraft(f);
  const result = await f.api(draft.path, 'POST', draft.body);
  assert.equal(result.status, 503);
  assert.match(result.data.error, /No article was sent/);
  assert(!JSON.stringify(result.data).includes('Private database failure'));
  assert.equal(sends, 0);
  assert.deepEqual(f.backing.publications(), []);
});

test('successful create followed by failed result storage retains a durable duplicate guard across app instances', async t => {
  let writes = 0, sends = 0;
  let persist = (_publication: Publication) => {};
  let read = (): Publication[] => [];
  const request: OutboundRequest = async () => {
    sends++;
    const marker = read()[0];
    assert.equal(marker.createOutcomeUnknown, true, 'marker must already exist before sending');
    assert.equal(marker.remoteId, undefined);
    return { ok: true, status: 201, json: async () => ({ id: 42, link: 'https://blog.example/protected-creation/' }) };
  };
  const f = await fixture(t, { env: wordpressEnv, wordpressRequest: request }, {
    putPublication: async publication => {
      writes++;
      if (writes === 2) throw new Error('Lost database connection before result write');
      persist(publication);
    },
  });
  persist = f.backing.putPublication;
  read = f.backing.publications;
  const draft = await liveDraft(f);
  const first = await f.api(draft.path, 'POST', draft.body);
  assert.equal(first.status, 503);
  assert.match(first.data.error, /uncertainty marker/);
  assert.equal(read()[0].createOutcomeUnknown, true);
  assert.equal(read()[0].remoteId, undefined);
  const visible = (await f.api('/state')).data.publications[0];
  assert.equal(visible.createOutcomeUnknown, undefined);
  assert.equal(visible.remoteId, undefined);

  // A fresh application has no in-memory active-publication guard to rely on.
  const { app } = createApplication({ store: f.store, env: wordpressEnv, wordpressRequest: request });
  const server: Server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing restarted fixture port');
  const retry = await fetch(`http://127.0.0.1:${address.port}/api${draft.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft.body) });
  const result = await retry.json();
  assert.equal(result.publications[0].status, 'failed');
  assert.match(result.publications[0].error, /uncertain outcome/);
  assert.equal(result.publications[0].createOutcomeUnknown, undefined);
  assert.equal(sends, 1);
});

test('a committed successful result with a lost acknowledgement retries only the known remote ID', async t => {
  let writes = 0;
  let persist = (_publication: Publication) => {};
  const sent: string[] = [];
  const f = await fixture(t, {
    env: wordpressEnv,
    wordpressRequest: async url => {
      sent.push(url);
      return { ok: true, status: 201, json: async () => ({ id: 42, link: 'https://blog.example/protected-creation/' }) };
    },
  }, {
    putPublication: async publication => {
      writes++;
      persist(publication);
      if (writes === 2) throw new Error('Acknowledgement was lost after commit');
    },
  });
  persist = f.backing.putPublication;
  const draft = await liveDraft(f);
  assert.equal((await f.api(draft.path, 'POST', draft.body)).status, 503);
  assert.equal(f.backing.publications()[0].remoteId, 42);
  assert.equal(f.backing.publications()[0].createOutcomeUnknown, undefined);
  const retry = await f.api(draft.path, 'POST', draft.body);
  assert.equal(retry.data.publications[0].status, 'published');
  assert.deepEqual(sent, ['https://blog.example/wp-json/wp/v2/posts', 'https://blog.example/wp-json/wp/v2/posts/42']);
});

test('ambiguous WordPress create responses retain the marker and block another create', async t => {
  const cases: { name: string; request: OutboundRequest }[] = [
    { name: 'connection interrupted after send', request: async () => { throw new Error('Interrupted after send'); } },
    { name: 'invalid successful response', request: async () => ({ ok: true, status: 201, json: async () => ({ invalid: true }) }) },
    { name: 'server error', request: async () => ({ ok: false, status: 500, json: async () => ({}) }) },
    { name: 'redirect', request: async () => ({ ok: false, status: 302, json: async () => ({}) }) },
  ];
  for (const scenario of cases) await t.test(scenario.name, async sub => {
    let sends = 0;
    const f = await fixture(sub, { env: wordpressEnv, wordpressRequest: async (...args) => { sends++; return scenario.request(...args); } });
    const draft = await liveDraft(f);
    const first = await f.api(draft.path, 'POST', draft.body);
    assert.equal(first.data.publications[0].status, 'failed');
    assert.equal(f.backing.publications()[0].createOutcomeUnknown, true);
    const retry = await f.api(draft.path, 'POST', draft.body);
    assert.match(retry.data.publications[0].error, /uncertain outcome/);
    assert.equal(sends, 1);
  });
});

test('confirmed unsent requests and explicit rejections can clear a persisted marker for a safe retry', async t => {
  for (const outcome of ['unsent', 'rejected'] as const) await t.test(outcome, async sub => {
    let sends = 0;
    const f = await fixture(sub, { env: wordpressEnv, wordpressRequest: async () => {
      sends++;
      if (sends === 1) {
        if (outcome === 'unsent') throw new UnsentRequestError('No bytes sent');
        return { ok: false, status: 403, json: async () => ({}) };
      }
      return { ok: true, status: 201, json: async () => ({ id: 42, link: 'https://blog.example/protected-creation/' }) };
    } });
    const draft = await liveDraft(f);
    const first = await f.api(draft.path, 'POST', draft.body);
    assert.equal(first.data.publications[0].status, 'failed');
    assert.equal(f.backing.publications()[0].createOutcomeUnknown, undefined);
    const retry = await f.api(draft.path, 'POST', draft.body);
    assert.equal(retry.data.publications[0].status, 'published');
    assert.equal(sends, 2);
    assert.equal(f.backing.publications()[0].remoteId, 42);
    assert.equal(f.backing.publications()[0].createOutcomeUnknown, undefined);
  });
});
