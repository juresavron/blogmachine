import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createTrgovinaSessions, trgovinaProjectUrl } from './trgovina-sessions.js';
import { createMediaspedSessions } from './mediasped-sessions.js';
import { createTrgovinaDraft, prepareTrgovinaDraft } from './trgovina.js';
import { listVenueArticles, prepareVenueDraft, venueProjectUrl, venueTargets } from './ocenagor-venues.js';

const id = '131ac648-51ab-4b25-9848-7a9139780e97';
const email = 'owner@example.invalid';
const token = `fixture.${Buffer.from(JSON.stringify({ sub: id, role: 'authenticated' })).toString('base64url')}.signature`;
const env = { TRGOVINA_SUPABASE_URL: trgovinaProjectUrl, TRGOVINA_SUPABASE_ANON_KEY: 'public-test-key', TRGOVINA_SUPABASE_ACCESS_TOKEN: token };
const json = (data: unknown, status = 200) => new globalThis.Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
type Sessions = ReturnType<typeof createTrgovinaSessions>;
function api(connection: Sessions, path: string, method = 'GET', body?: unknown, cookie = '') {
  return new Promise<{ status: number; data: Record<string, unknown>; cookie: string }>((resolve, reject) => {
    const jar = new Map(cookie.split('; ').filter(Boolean).map(value => value.split('=')) as [string, string][]);
    const req = { method, url: path, body, headers: { cookie, host: 'workspace.example', origin: 'https://workspace.example' }, ip: 'fixture-browser', secure: true, aborted: false,
      get(this: { headers: Record<string, string> }, name: string) { return this.headers[name.toLowerCase()]; },
    } as unknown as Request;
    let status = 200;
    const res = { destroyed: false, writableEnded: false,
      status(value: number) { status = value; return this; }, set() { return this; },
      cookie(name: string, value: string) { jar.set(name, value); return this; },
      json(this: { writableEnded: boolean }, data: Record<string, unknown>) { this.writableEnded = true; resolve({ status, data, cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') }); return this; },
    } as unknown as Response;
    connection.router(req, res, error => reject(error || new Error('Route did not respond')));
  });
}
test('Trgovina email sign-in verifies its own project and admin RPC, and cannot reuse a Mediašped proof or cookie', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = new URL(String(input)); assert.equal(url.origin, trgovinaProjectUrl); calls.push(url.pathname);
    if (url.pathname.endsWith('/otp')) return json({});
    if (url.pathname.endsWith('/verify')) return json({ access_token: token, refresh_token: 'private-refresh', expires_in: 3600, user: { email } });
    if (url.pathname.endsWith('/user')) return json({ id, email });
    if (url.pathname.endsWith('/is_admin')) return json(true);
    throw new Error('Unexpected request');
  };
  const sessions = createTrgovinaSessions({ workspace: '/missing', env, request });
  const browser = await api(sessions, '/connections/trgovina/session');
  await api(sessions, '/connections/trgovina/email/start', 'POST', { email }, browser.cookie);
  const foreign = await api(sessions, '/connections/trgovina/email/verify', 'POST', { proof: 'https://ytmowbzkpofeeocgevyr.supabase.co/auth/v1/verify?token=123456789012345678901234&type=magiclink' }, browser.cookie);
  assert.equal(foreign.status, 400); assert.equal(calls.includes('/auth/v1/verify'), false);
  const connected = await api(sessions, '/connections/trgovina/email/verify', 'POST', { proof: '123456' }, browser.cookie);
  assert.equal(connected.status, 200); assert.equal(connected.data.admin, true);
  assert.match(connected.cookie, /bm_trgovina_session=/); assert.equal(connected.cookie.includes('bm_mediasped_session='), false);
  assert.equal(JSON.stringify(connected).includes(token), false);
  const media = createMediaspedSessions({ workspace: '/missing', env: {}, request: async () => { throw new Error('Must not exchange a foreign cookie'); } });
  assert.equal((await api(media, '/connections/mediasped/session', 'GET', undefined, connected.cookie)).data.authenticated, false);
  assert.equal((await api(sessions, '/connections/trgovina/session', 'GET', undefined, connected.cookie)).data.authenticated, true);
});
test('Trgovina draft writes require admin, insert a stable unpublished row and recover only an identical draft', async () => {
  const payload = prepareTrgovinaDraft({ title: 'Example title', slug: 'example-title', excerpt: 'A helpful summary', content: 'Plain text article.' }, 'bazen', id);
  let inserts = 0, admin = true, conflict: unknown = payload;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, trgovinaProjectUrl);
    if (url.pathname.endsWith('/user')) return json({ id });
    if (url.pathname.endsWith('/is_admin')) return json(admin);
    assert.equal(url.pathname, '/rest/v1/posts');
    assert.ok(['GET', 'POST'].includes(init?.method || 'GET'));
    if (init?.method === 'POST') { inserts++; assert.deepEqual(JSON.parse(String(init.body)), payload); return inserts === 1 ? json([{ ...payload, updated_at: 'now' }]) : json({}, 409); }
    assert.equal(url.searchParams.get('id'), `eq.${id}`); assert.equal(url.searchParams.get('shop_id'), 'eq.bazen'); assert.equal(url.searchParams.get('status'), 'eq.draft');
    return json([conflict]);
  };
  await createTrgovinaDraft(payload, env, request); await createTrgovinaDraft(payload, env, request);
  conflict = { ...payload, body: { source: 'Someone changed it.' } };
  await assert.rejects(createTrgovinaDraft(payload, env, request), /conflicts/);
  admin = false; const before = inserts;
  await assert.rejects(createTrgovinaDraft(payload, env, request), /not verified/); assert.equal(inserts, before);
  await assert.rejects(createTrgovinaDraft({ ...payload, status: 'published' }, env, request));
});
test('customer blog reads use the fixed tenant-scoped public RPC, check canonical identity and never fetch supplied URLs', async () => {
  const target = venueTargets[0]; let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls++; const url = new URL(String(input)); assert.equal(url.origin, venueProjectUrl); assert.equal(url.pathname, '/rest/v1/rpc/tenant_blog_public');
    assert.equal(url.searchParams.get('p_company_id'), target.key); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    return json({ base: target.url, articles: [{ slug: 'weekend-visit', title: 'Weekend visit', excerpt: 'Visit us this weekend.' }] });
  };
  const articles = await listVenueArticles(target.key, request); assert.equal(articles[0].url, `${target.url}/blog/weekend-visit`);
  await assert.rejects(listVenueArticles('http://localhost/private', request)); assert.equal(calls, 1);
  await assert.rejects(listVenueArticles(target.key, async () => json({ base: 'https://other.example', articles: [] })), /identity changed/);
  assert.deepEqual(await listVenueArticles(target.key, async () => json(null)), []);
});
test('customer drafts stay unapproved and validate the real tenant table limits', () => {
  const target = venueTargets[0], draft = { title: 'Weekend visit', slug: 'weekend-visit', excerpt: 'A useful summary for your weekend visit.', content: 'A complete plain text article with enough useful context for a draft.' };
  const payload = prepareVenueDraft(draft, target.key, id);
  assert.equal(payload.company_id, target.key); assert.equal(payload.status, 'draft'); assert.equal(payload.approved_at, null); assert.equal(payload.published_at, null);
  assert.equal(payload.language, target.locale); assert.equal(payload.partner_company_id, null);
  assert.throws(() => prepareVenueDraft({ ...draft, title: 'X'.repeat(131) }, target.key));
  assert.throws(() => prepareVenueDraft({ ...draft, excerpt: 'X'.repeat(281) }, target.key));
  assert.throws(() => prepareVenueDraft({ ...draft, content: '<script>unsafe</script>' }, target.key));
  assert.throws(() => prepareVenueDraft(draft, 'unknown'));
});
