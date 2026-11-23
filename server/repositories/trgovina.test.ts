import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTrgovinaArticles, prepareTrgovinaDraft, testTrgovinaConnection, trgovinaTargets, type TrgovinaRequest } from './trgovina.js';

const id = '0c054fe3-041e-4544-9011-74eb563b1785';
const env = { TRGOVINA_SUPABASE_URL: 'https://project.supabase.co', TRGOVINA_SUPABASE_ANON_KEY: 'public-test-key', TRGOVINA_SUPABASE_ACCESS_TOKEN: 'private-test-token' };
const draft = { title: 'A useful guide', slug: 'a-useful-guide', excerpt: 'A short description.', content: '## A heading\n\nA plain-text paragraph.\n\nV: Question?\nO: Answer.' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Trgovina targets distinguish source live flag from runtime evidence', () => {
  assert.deepEqual(trgovinaTargets.map(({ key, sourceLive }) => ({ key, sourceLive })), [{ key: 'bazen', sourceLive: true }, { key: 'vrecke', sourceLive: false }]);
  assert.equal(trgovinaTargets[0].url, 'https://masaznibazenivrelec.si');
  assert.equal(trgovinaTargets[1].locale, 'sl-SI');
});

test('Trgovina payload is a stable-ID draft with source text and no publication side effects', () => {
  const payload = prepareTrgovinaDraft(draft, 'bazen', id);
  assert.deepEqual(payload, { id, shop_id: 'bazen', slug: draft.slug, title: draft.title, excerpt: draft.excerpt, body: { source: draft.content }, cover_url: null, cover_alt: '', status: 'draft', published_at: null });
  assert.deepEqual(prepareTrgovinaDraft(draft, 'bazen', id), payload);
  assert.equal(prepareTrgovinaDraft(draft, 'vrecke', id).shop_id, 'vrecke');
  assert.throws(() => prepareTrgovinaDraft(draft, 'unknown', id), /Unknown Trgovina shop/);
  assert.throws(() => prepareTrgovinaDraft(draft, 'bazen', 'unsafe-id'));
  assert.throws(() => prepareTrgovinaDraft({ ...draft, slug: '../evil' }, 'bazen', id));
  assert.throws(() => prepareTrgovinaDraft({ ...draft, status: 'published' } as typeof draft, 'bazen', id));
});

test('missing Trgovina credentials make no outbound request', async () => {
  let requests = 0;
  const request: TrgovinaRequest = async () => { requests++; throw new Error('Should not send'); };
  const missing = await testTrgovinaConnection({}, request);
  assert.equal(missing.configured, false);
  const publicOnly = await testTrgovinaConnection({ ...env, TRGOVINA_SUPABASE_ACCESS_TOKEN: undefined }, request);
  assert.equal(publicOnly.configured, false);
  assert.equal(requests, 0);
});

test('Trgovina rejects arbitrary hosts, credentials, paths, custom ports and redirects', async () => {
  let requests = 0;
  const request: TrgovinaRequest = async () => { requests++; return json({ id }); };
  for (const url of ['https://evil.example', 'http://project.supabase.co', 'https://supabase.co', 'https://project.supabase.co.evil.example', 'https://sub.project.supabase.co', 'https://user:private@project.supabase.co', 'https://project.supabase.co/path', 'https://project.supabase.co:8443', 'https://project.supabase.co/?q=private', 'https://project.supabase.co/#private']) {
    const result = await testTrgovinaConnection({ ...env, TRGOVINA_SUPABASE_URL: url }, request);
    assert.equal(result.configured, false, url);
    assert.equal(JSON.stringify(result).includes('user:private'), false);
  }
  assert.equal(requests, 0);
});

test('Trgovina auth verifies identity then calls only the read-only existing admin RPC', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await testTrgovinaConnection(env, async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? json({ id, email: 'not-returned@example.com' }) : json(true); });
  assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.init.method]), [['/auth/v1/user', 'GET'], ['/rest/v1/rpc/is_admin', 'POST']]);
  assert.ok(calls.every(call => call.init.redirect === 'error'));
  assert.equal(calls[1].init.body, '{}');
  assert.equal(result.authenticated, true);
  assert.equal(result.admin, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(env.TRGOVINA_SUPABASE_ACCESS_TOKEN), false);
  assert.equal(serialized.includes('not-returned@example.com'), false);
  assert.equal(serialized.includes(id), false);
});

test('Trgovina denied identity never attempts admin RPC or leaks upstream errors', async () => {
  let calls = 0;
  const result = await testTrgovinaConnection(env, async () => { calls++; return json({ error: env.TRGOVINA_SUPABASE_ACCESS_TOKEN }, 401); });
  assert.equal(calls, 1);
  assert.equal(result.authenticated, false);
  assert.equal(result.admin, false);
  assert.equal(JSON.stringify(result).includes(env.TRGOVINA_SUPABASE_ACCESS_TOKEN), false);
});

test('Trgovina authentication alone does not grant administrator rights', async () => {
  let calls = 0;
  const result = await testTrgovinaConnection(env, async () => ++calls === 1 ? json({ id }) : json(false));
  assert.equal(result.authenticated, true);
  assert.equal(result.admin, false);
  assert.match(result.message, /not on the admin allowlist/);
  calls = 0;
  const malformed = await testTrgovinaConnection(env, async () => ++calls === 1 ? json({ id }) : json({ admin: true }));
  assert.equal(malformed.admin, false);
  assert.match(malformed.message, /unrecognized/);
});

test('Trgovina network and invalid identity responses remain unverified without secret values', async () => {
  const network = await testTrgovinaConnection(env, async () => { throw new Error(`token: ${env.TRGOVINA_SUPABASE_ACCESS_TOKEN}`); });
  assert.equal(network.authenticated, false);
  assert.equal(JSON.stringify(network).includes(env.TRGOVINA_SUPABASE_ACCESS_TOKEN), false);
  let calls = 0;
  const invalid = await testTrgovinaConnection(env, async () => { calls++; return json({ id: '' }); });
  assert.equal(invalid.authenticated, false);
  assert.equal(calls, 1);
});

test('Trgovina article reads are strictly tenant-filtered, published-only GETs', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const articles = await listTrgovinaArticles('bazen', env, async (url, init) => { calls.push({ url, init }); return json([{ id, slug: 'existing-post', title: 'Existing post', excerpt: 'Summary' }]); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('shop_id'), 'eq.bazen');
  assert.equal(url.searchParams.get('status'), 'eq.published');
  assert.equal(url.searchParams.get('select'), 'id,slug,title,excerpt');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(articles, [{ slug: 'existing-post', title: 'Existing post', description: 'Summary', url: 'https://masaznibazenivrelec.si/blog/existing-post' }]);
});

test('Trgovina public article reads need no authenticated token and cannot use unknown shop filters', async () => {
  let calls = 0;
  await listTrgovinaArticles('vrecke', { ...env, TRGOVINA_SUPABASE_ACCESS_TOKEN: undefined }, async (url, init) => {
    calls++;
    assert.equal((init.headers as Record<string, string>).Authorization, undefined);
    assert.equal(new URL(url).searchParams.get('shop_id'), 'eq.vrecke');
    return json([]);
  });
  assert.equal(calls, 1);
  await assert.rejects(() => listTrgovinaArticles('bazen&shop_id=eq.evil', env, async () => { throw new Error('Should not send'); }), /Unknown Trgovina shop/);
});

test('Trgovina list errors do not leak upstream bodies or create unsafe article URLs', async () => {
  await assert.rejects(() => listTrgovinaArticles('bazen', env, async () => json({ error: env.TRGOVINA_SUPABASE_ACCESS_TOKEN }, 403)), error => error instanceof Error && !error.message.includes(env.TRGOVINA_SUPABASE_ACCESS_TOKEN));
  await assert.rejects(() => listTrgovinaArticles('bazen', env, async () => json([{ slug: '../../escape', title: 'Unsafe', excerpt: '' }])), /unrecognized article list/);
});

test('Trgovina refuses service-role keys and tokens without transmitting them', async () => {
  const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.test-signature`;
  let calls = 0;
  const request: TrgovinaRequest = async () => { calls++; throw new Error('Must not send'); };
  for (const config of [
    { ...env, TRGOVINA_SUPABASE_ANON_KEY: 'sb_secret_example' },
    { ...env, TRGOVINA_SUPABASE_ANON_KEY: serviceJwt },
    { ...env, TRGOVINA_SUPABASE_ACCESS_TOKEN: serviceJwt },
  ]) {
    const result = await testTrgovinaConnection(config, request);
    assert.equal(result.configured, false);
    assert.match(result.message, /Service-role credentials are not supported/);
    assert.equal(result.message.includes(serviceJwt), false);
  }
  assert.equal(calls, 0);
});
