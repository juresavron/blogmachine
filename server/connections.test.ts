import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import type { OutboundRequest } from './network.js';
import { normalizeSiteUrl, normalizeWordpressRequestUrl, wordpressRequest } from './network.js';

const requests: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
const usernames = ['auth', 'nocap', 'denied', 'forbidden', 'malformed', 'nopublish', 'offline'];
const env: NodeJS.ProcessEnv = {};
for (const key of usernames) {
  env[`${key.toUpperCase()}_URL`] = `https://${key}.example`;
  env[`${key.toUpperCase()}_USERNAME`] = 'private-user';
  env[`${key.toUpperCase()}_APPLICATION_PASSWORD`] = 'private-password';
}
const outbound: OutboundRequest = async (value, init) => {
  requests.push({ url: value, ...init });
  const url = new URL(value);
  if (url.hostname === 'offline.example') throw new Error('Simulated network failure containing private diagnostic details');
  const status = url.hostname === 'denied.example' ? 401 : url.hostname === 'forbidden.example' ? 403 : url.hostname === 'redirect.example' ? 301 : 200;
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => {
      if (url.hostname === 'html.example') throw new SyntaxError('Unexpected HTML response');
      if (url.pathname === '/wp-json/wp/v2/users/me') {
        assert.equal(url.search, '?context=edit');
        if (url.hostname === 'malformed.example') return { name: 'private-name', roles: ['administrator'] };
        if (url.hostname === 'nocap.example') return { id: 12, name: 'private-name', email: 'private@example.com', roles: ['administrator'] };
        return { id: 12, name: 'private-name', email: 'private@example.com', capabilities: { publish_posts: url.hostname !== 'nopublish.example' } };
      }
      if (url.hostname === 'invalid.example') return { namespaces: 'wp/v2' };
      if (url.hostname === 'unknown.example') return { namespaces: ['other/v1'], routes: {} };
      if (url.hostname === 'routes.example') return { routes: { '/wp/v2/posts': { namespace: 'wp/v2' } } };
      return { namespaces: ['wp/v2', 'oembed/1.0'] };
    },
  };
};
const { app, store } = createApp({ databasePath: ':memory:', seed: false, env, wordpressRequest: outbound });
let server: Server;
let base = '';
async function api(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });

test('discovery detects validated WordPress namespaces or publishing routes with one unauthenticated GET', async () => {
  await api('/sites', { name: 'Configured website', url: 'https://auth.example', platform: 'wordpress', credentialKey: 'AUTH' });
  const before = (await api('/state', undefined, 'GET')).data;
  for (const url of ['https://auth.example/', 'https://routes.example']) {
    const start = requests.length;
    const result = await api('/connections/discover', { url });
    assert.equal(result.status, 200);
    assert.equal(result.data.platform, 'wordpress');
    assert.equal(result.data.reachable, true);
    assert.equal(result.data.wordpressDetected, true);
    assert.equal(result.data.credentialsRequired, true);
    assert.equal(requests.length, start + 1);
    assert.equal(requests.at(-1)!.method, 'GET');
    assert.ok(requests.at(-1)!.url.endsWith('/wp-json/'));
    assert.equal(Object.keys(requests.at(-1)!.headers).some(key => key.toLowerCase() === 'authorization'), false);
    assert.equal(requests.at(-1)!.body, undefined);
  }
  assert.deepEqual((await api('/state', undefined, 'GET')).data, before);
});

test('HTML, invalid metadata, and other APIs leave the CMS unknown without declaring non-WordPress', async () => {
  for (const hostname of ['html.example', 'invalid.example', 'unknown.example']) {
    const result = await api('/connections/discover', { url: `https://${hostname}` });
    assert.equal(result.status, 200);
    assert.equal(result.data.platform, 'unknown');
    assert.equal(result.data.wordpressDetected, false);
    assert.equal(result.data.reachable, true);
    assert.match(result.data.message, /unverified/);
  }
});

test('network failures, denial, and redirects are reported without retries or invented CMS detection', async () => {
  for (const hostname of ['offline.example', 'forbidden.example', 'redirect.example']) {
    const start = requests.length;
    const result = await api('/connections/discover', { url: `https://${hostname}` });
    assert.equal(result.status, 200);
    assert.equal(result.data.platform, 'unknown');
    assert.equal(result.data.reachable, false);
    assert.equal(result.data.wordpressDetected, false);
    assert.match(result.data.message, /unverified/);
    assert.equal(JSON.stringify(result.data).includes('private diagnostic details'), false);
    assert.equal(requests.length, start + 1);
  }
  const unauthenticated = await api('/connections/discover', { url: 'https://denied.example' });
  assert.equal(unauthenticated.data.credentialsRequired, true);
  assert.equal(unauthenticated.data.platform, 'unknown');
});

test('discovery rejects unsafe or malformed website addresses before any outbound call', async () => {
  const start = requests.length;
  for (const url of ['http://auth.example', 'https://127.0.0.1', 'https://user:pass@auth.example', 'not a URL']) {
    assert.equal((await api('/connections/discover', { url })).status, 400);
  }
  assert.equal(requests.length, start);
});

test('WordPress connection testing performs only an authenticated account GET and returns no identity details', async () => {
  const site = (await api('/state', undefined, 'GET')).data.sites[0];
  const before = (await api('/state', undefined, 'GET')).data;
  const start = requests.length;
  const result = await api(`/sites/${site.id}/test-connection`);
  assert.equal(result.status, 200);
  assert.equal(result.data.authenticated, true);
  assert.equal(result.data.canPublish, true);
  assert.equal(requests.length, start + 1);
  assert.equal(requests.at(-1)!.method, 'GET');
  assert.equal(requests.at(-1)!.url, 'https://auth.example/wp-json/wp/v2/users/me?context=edit');
  assert.equal(requests.at(-1)!.headers.Authorization, `Basic ${Buffer.from('private-user:private-password').toString('base64')}`);
  assert.equal(requests.at(-1)!.body, undefined);
  assert.deepEqual(Object.keys(result.data).sort(), ['authenticated', 'canPublish', 'message']);
  for (const value of ['private-user', 'private-password', 'private-name', 'private@example.com']) assert.equal(JSON.stringify(result.data).includes(value), false);
  assert.deepEqual((await api('/state', undefined, 'GET')).data, before);
});

test('account identity without capability evidence leaves publishing permission unknown, even for administrator role', async () => {
  const site = (await api('/sites', { name: 'No capability', url: 'https://nocap.example', platform: 'wordpress', credentialKey: 'NOCAP' })).data;
  const result = await api(`/sites/${site.id}/test-connection`);
  assert.equal(result.data.authenticated, true);
  assert.equal(result.data.canPublish, null);
  assert.match(result.data.message, /permission remains unverified/);
});

test('known missing publish_posts capability is distinct from failed authentication', async () => {
  const site = (await api('/sites', { name: 'No publish', url: 'https://nopublish.example', platform: 'wordpress', credentialKey: 'NOPUBLISH' })).data;
  const result = await api(`/sites/${site.id}/test-connection`);
  assert.equal(result.data.authenticated, true);
  assert.equal(result.data.canPublish, false);
});

test('connection tests distinguish rejected credentials from unreachable or invalid account endpoints', async () => {
  for (const hostname of ['denied', 'forbidden', 'malformed', 'offline']) {
    const site = (await api('/sites', { name: hostname, url: `https://${hostname}.example`, platform: 'wordpress', credentialKey: hostname.toUpperCase() })).data;
    const result = await api(`/sites/${site.id}/test-connection`);
    assert.equal(result.status, 200);
    assert.equal(result.data.authenticated, false);
    assert.equal(result.data.canPublish, hostname === 'denied' ? false : null);
    assert.equal(JSON.stringify(result.data).includes('private diagnostic details'), false);
  }
});

test('connection tests reject missing bound credentials and non-WordPress sites without outbound requests', async () => {
  const missing = (await api('/sites', { name: 'Missing auth', url: 'https://missing.example', platform: 'wordpress' })).data;
  const manual = (await api('/sites', { name: 'Manual', url: 'https://manual.example', platform: 'manual' })).data;
  const wrongUrl = (await api('/sites', { name: 'Wrong URL', url: 'https://wrong.example', platform: 'wordpress', credentialKey: 'AUTH' })).data;
  const start = requests.length;
  assert.equal((await api(`/sites/${missing.id}/test-connection`)).status, 409);
  assert.equal((await api(`/sites/${wrongUrl.id}/test-connection`)).status, 409);
  assert.equal((await api(`/sites/${manual.id}/test-connection`)).status, 400);
  assert.equal(requests.length, start);
});

test('only the exact read-only account capability query is permitted by the WordPress transport', async () => {
  for (const url of [
    'https://auth.example/wp-json/wp/v2/users/me?context=view',
    'https://auth.example/wp-json/wp/v2/users/me?context=edit&other=1',
    'https://auth.example/wp-json/wp/v2/users/me?context=%65dit',
    'https://auth.example/wp-json/wp/v2/posts?context=edit',
    'https://auth.example/wp-json/?context=edit',
  ]) {
    await assert.rejects(wordpressRequest(url, { method: 'GET', headers: {} }), /Only GET account capability checks/);
  }
  await assert.rejects(wordpressRequest('https://auth.example/wp-json/wp/v2/users/me?context=edit', { method: 'POST', headers: {} }), /Only GET account capability checks/);
  assert.equal(normalizeWordpressRequestUrl('https://auth.example/blog/wp-json/wp/v2/users/me?context=edit', 'GET').search, '?context=edit');
  assert.equal(normalizeWordpressRequestUrl('https://auth.example/wp-json/', 'GET').pathname, '/wp-json/');
  assert.throws(() => normalizeSiteUrl('https://auth.example/?context=edit'), /cannot include a query/);
  assert.throws(() => normalizeWordpressRequestUrl('https://127.0.0.1/wp-json/wp/v2/users/me?context=edit', 'GET'), /public website address/);
  assert.throws(() => normalizeWordpressRequestUrl('https://auth.example/wp-json/wp/v2/users/me?context=edit#unsafe', 'GET'), /cannot include a query or fragment/);
});
