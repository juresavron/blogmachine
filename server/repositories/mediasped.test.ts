import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaspedDraft, listMediaspedArticles, mediaspedTargets, prepareMediaspedDraft, testMediaspedConnection, type MediaspedRequest } from './mediasped.js';

const userId = 'b59f4814-1c4c-4776-9474-379e464044e0';
const draftId = 'bde54735-6a54-4435-9419-28c9436f843a';
const token = (role: string) => `test.${Buffer.from(JSON.stringify({ role, sub: userId })).toString('base64url')}.signature`;
const env = { MEDIASPED_SUPABASE_URL: 'https://ytmowbzkpofeeocgevyr.supabase.co', MEDIASPED_SUPABASE_ANON_KEY: token('anon'), MEDIASPED_SUPABASE_ACCESS_TOKEN: token('authenticated') };
const draft = { title: 'A clear shipment plan', slug: 'a-clear-shipment-plan', excerpt: 'Prepare the information for your next shipment.', content: '## Start & plan\nWrite down the cargo details.\n\nConfirm the next step.' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
type SeenRequest = { url: URL; init: RequestInit };
function mock(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const requests: SeenRequest[] = [];
  const request: MediaspedRequest = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    requests.push({ url, init });
    return handler(url, init);
  };
  return { request, requests };
}
function authenticated(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return mock((url, init) => {
    if (url.pathname === '/auth/v1/user') return json({ id: userId, email: 'private@example.com' });
    if (url.pathname === '/rest/v1/rpc/is_admin') return json(true);
    return handler(url, init);
  });
}

test('Mediašped targets use actual served languages and safe unpublished payload fields', () => {
  assert.deepEqual(mediaspedTargets.map(target => target.key), ['en', 'sl', 'ar', 'sk', 'hu', 'cs', 'de', 'hr', 'it']);
  const payload = prepareMediaspedDraft(draft, 'sl', { tags: ['shipping'], meta_title: 'A useful title' }, draftId);
  assert.equal(payload.id, draftId);
  assert.equal(payload.language, 'sl');
  assert.equal(payload.published, false);
  assert.equal(payload.published_at, null);
  assert.equal(payload.content, '<h2>Start &amp; plan</h2>\n<p>Write down the cargo details.</p>\n<p>Confirm the next step.</p>');
  assert.equal('author_id' in payload, false);
  assert.equal('clientUUID' in payload, false);
  assert.throws(() => prepareMediaspedDraft(draft, 'arz', {}, draftId));
  assert.throws(() => prepareMediaspedDraft(draft, 'en', { published: true }, draftId));
});

test('payload preparation rejects unsafe HTML, static guide collisions, and invalid optional metadata', () => {
  assert.throws(() => prepareMediaspedDraft({ ...draft, content: '<script>alert(1)</script>' }, 'en', {}, draftId), /plain text/);
  assert.throws(() => prepareMediaspedDraft({ ...draft, slug: 'first-freight-shipment-checklist' }, 'sl', {}, draftId), /reserved/);
  assert.throws(() => prepareMediaspedDraft({ ...draft, slug: 'freight-forwarder-cost' }, 'de', {}, draftId), /reserved/);
  assert.throws(() => prepareMediaspedDraft(draft, 'en', { featured_image: 'http://example.com/image.png' }, draftId));
  assert.throws(() => prepareMediaspedDraft(draft, 'en', { author_id: userId }, draftId));
  assert.throws(() => prepareMediaspedDraft(draft, 'en', {}, 'invalid-id'));
});

test('connection verification derives identity and checks the actual admin RPC without writing content', async () => {
  const { request, requests } = authenticated(() => { throw new Error('Unexpected blog operation'); });
  const result = await testMediaspedConnection(env, request);
  assert.deepEqual({ configured: result.configured, authenticated: result.authenticated, admin: result.admin }, { configured: true, authenticated: true, admin: true });
  assert.deepEqual(requests.map(entry => [entry.url.pathname, entry.init.method]), [['/auth/v1/user', 'GET'], ['/rest/v1/rpc/is_admin', 'POST']]);
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), { _user_id: userId });
  const headers = new Headers(requests[0]!.init.headers);
  assert.equal(headers.get('Authorization'), `Bearer ${env.MEDIASPED_SUPABASE_ACCESS_TOKEN}`);
  assert.equal(headers.get('apikey'), env.MEDIASPED_SUPABASE_ANON_KEY);
  assert.equal(requests.every(entry => entry.init.redirect === 'error'), true);
  const output = JSON.stringify(result);
  for (const secret of [env.MEDIASPED_SUPABASE_ACCESS_TOKEN, env.MEDIASPED_SUPABASE_ANON_KEY, userId, 'private@example.com']) assert.equal(output.includes(secret), false);
});

test('wrong project, absent session, and service-role credentials never trigger network calls', async () => {
  const { request, requests } = mock(() => { throw new Error('Unexpected request'); });
  for (const invalid of [
    { ...env, MEDIASPED_SUPABASE_URL: 'https://attacker.example' },
    { ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: '' },
    { ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: token('service_role') },
    { ...env, MEDIASPED_SUPABASE_ANON_KEY: token('service_role') },
  ]) {
    const result = await testMediaspedConnection(invalid, request);
    assert.equal(result.configured, false);
    assert.equal(result.authenticated, false);
    assert.equal(result.admin, false);
  }
  assert.equal(requests.length, 0);
});

test('failed or insufficient authentication is reported without upstream response data', async () => {
  const rejected = mock(() => json({ error: 'private upstream diagnostic' }, 401));
  const result = await testMediaspedConnection(env, rejected.request);
  assert.equal(result.configured, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.admin, false);
  assert.equal(rejected.requests.length, 1);
  const nonAdmin = mock(url => url.pathname === '/auth/v1/user' ? json({ id: userId }) : json(false));
  const denied = await testMediaspedConnection(env, nonAdmin.request);
  assert.equal(denied.authenticated, true);
  assert.equal(denied.admin, false);
  assert.equal(JSON.stringify(result).includes('private upstream diagnostic'), false);
});

test('public listing filters publication and language and uses only the public key', async () => {
  const { request, requests } = mock(() => json([{ slug: draft.slug, title: draft.title, excerpt: draft.excerpt, language: 'sl' }]));
  const result = await listMediaspedArticles('sl', env, request);
  assert.deepEqual(result, [{ slug: draft.slug, title: draft.title, description: draft.excerpt, url: `https://mediasped.com/sl/blog/${draft.slug}/` }]);
  assert.equal(requests[0]!.url.searchParams.get('published'), 'eq.true');
  assert.equal(requests[0]!.url.searchParams.get('language'), 'eq.sl');
  assert.equal(requests[0]!.init.method, 'GET');
  assert.equal(new Headers(requests[0]!.init.headers).get('Authorization'), `Bearer ${env.MEDIASPED_SUPABASE_ANON_KEY}`);
});

test('listing rejects mismatched languages and keeps network diagnostics private', async () => {
  const wrongLanguage = mock(() => json([{ slug: draft.slug, title: draft.title, excerpt: null, language: 'de' }]));
  await assert.rejects(listMediaspedArticles('sl', env, wrongLanguage.request), /Could not read/);
  const unreachable = mock(() => { throw new Error(`private: ${env.MEDIASPED_SUPABASE_ACCESS_TOKEN}`); });
  await assert.rejects(listMediaspedArticles('en', env, unreachable.request), error => !String(error).includes(env.MEDIASPED_SUPABASE_ACCESS_TOKEN));
});

test('public listing preserves existing non-Latin slugs supported by the website', async () => {
  const slug = 'دليل-الشحن';
  const { request } = mock(() => json([{ slug, title: 'دليل الشحن', excerpt: null, language: 'ar' }]));
  const articles = await listMediaspedArticles('ar', env, request);
  assert.equal(articles[0]!.slug, slug);
  assert.equal(articles[0]!.url, `https://mediasped.com/ar/blog/${encodeURIComponent(slug)}/`);
});

test('explicit draft creation uses stable UUID, verified author, and never requests publication', async () => {
  const payload = prepareMediaspedDraft(draft, 'en', {}, draftId);
  const { request, requests } = authenticated((_url, init) => json([JSON.parse(String(init.body))], 201));
  const result = await createMediaspedDraft(payload, env, request);
  const insert = requests.find(entry => entry.url.pathname === '/rest/v1/blog_posts')!;
  const sent = JSON.parse(String(insert.init.body));
  assert.equal(insert.init.method, 'POST');
  assert.equal(sent.id, draftId);
  assert.equal(sent.author_id, userId);
  assert.equal(sent.published, false);
  assert.equal(sent.published_at, null);
  assert.equal(new Headers(insert.init.headers).get('Prefer'), 'return=representation');
  assert.equal(result.published, false);
  assert.equal(result.id, draftId);
  assert.equal(JSON.stringify(result).includes(userId), false);
});

test('duplicate draft save recovers only the same ID, same language, identical unpublished content', async () => {
  const payload = prepareMediaspedDraft(draft, 'sl', {}, draftId);
  const { request, requests } = authenticated((_url, init) => init.method === 'POST' ? json({}, 409) : json([{ ...payload, author_id: userId }]));
  const result = await createMediaspedDraft(payload, env, request);
  const read = requests.at(-1)!;
  assert.equal(read.init.method, 'GET');
  assert.equal(read.url.searchParams.get('id'), `eq.${draftId}`);
  assert.equal(read.url.searchParams.get('language'), 'eq.sl');
  assert.equal(result.id, draftId);
  assert.equal(requests.some(entry => ['PATCH', 'PUT', 'DELETE'].includes(entry.init.method ?? '')), false);
});

test('a conflicting published, edited, foreign-author, or missing draft is never overwritten', async () => {
  const payload = prepareMediaspedDraft(draft, 'en', {}, draftId);
  for (const rows of [
    [{ ...payload, author_id: userId, published: true }],
    [{ ...payload, author_id: userId, title: 'An independently edited draft' }],
    [{ ...payload, author_id: '695d80f6-a9c5-4125-b54c-a9eb9120e962' }],
    [],
  ]) {
    const { request, requests } = authenticated((_url, init) => init.method === 'POST' ? json({}, 409) : json(rows));
    await assert.rejects(createMediaspedDraft(payload, env, request), /Nothing was overwritten/);
    assert.equal(requests.some(entry => ['PATCH', 'PUT', 'DELETE'].includes(entry.init.method ?? '')), false);
  }
});

test('unknown creation outcomes can be safely recovered by retrying the same UUID', async () => {
  const payload = prepareMediaspedDraft(draft, 'en', {}, draftId);
  let interrupted = true;
  const { request, requests } = authenticated((_url, init) => {
    if (init.method === 'POST') {
      if (interrupted) { interrupted = false; throw new Error('Simulated post-send failure'); }
      return json({}, 409);
    }
    return json([{ ...payload, author_id: userId }]);
  });
  await assert.rejects(createMediaspedDraft(payload, env, request), /same draft ID/);
  assert.equal((await createMediaspedDraft(payload, env, request)).id, draftId);
  const inserts = requests.filter(entry => entry.url.pathname === '/rest/v1/blog_posts' && entry.init.method === 'POST');
  assert.equal(inserts.length, 2);
  assert.equal(inserts.every(entry => JSON.parse(String(entry.init.body)).id === draftId), true);
});

test('create refuses publishing payloads, raw unsafe HTML, or unverified administrator access', async () => {
  const payload = prepareMediaspedDraft(draft, 'en', {}, draftId);
  const { request, requests } = mock(url => url.pathname === '/auth/v1/user' ? json({ id: userId }) : json(false));
  await assert.rejects(createMediaspedDraft({ ...payload, published: true } as never, env, request));
  await assert.rejects(createMediaspedDraft({ ...payload, content: '<script>bad()</script>' }, env, request), /escaped paragraph/);
  assert.equal(requests.length, 0);
  await assert.rejects(createMediaspedDraft(payload, env, request), /verified Mediašped administrator/);
  assert.equal(requests.some(entry => entry.url.pathname === '/rest/v1/blog_posts'), false);
});
