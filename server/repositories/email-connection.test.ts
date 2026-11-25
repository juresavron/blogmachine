import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createMediaspedSessions } from './mediasped-sessions.js';

const project = 'https://ytmowbzkpofeeocgevyr.supabase.co';
const userId = '131ac648-51ab-4b25-9848-7a9139780e97';
const email = 'owner@example.invalid';
const access = `fixture.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated' })).toString('base64url')}.signature`;
function fixture() {
  let now = Date.UTC(2026, 10, 25, 12);
  let admin = true;
  let returnedEmail = email;
  const calls: { path: string; body: unknown }[] = [];
  const json = (data: unknown) => new globalThis.Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const connection = createMediaspedSessions({ workspace: '/nonexistent-website-source', env: { MEDIASPED_SUPABASE_URL: project, MEDIASPED_SUPABASE_ANON_KEY: 'public-test-key' }, now: () => now,
    request: async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.origin, project);
      calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === '/auth/v1/otp') return json({});
      if (url.pathname === '/auth/v1/verify') return json({ access_token: access, refresh_token: 'test-refresh-private', expires_in: 3600, user: { email: returnedEmail } });
      if (url.pathname === '/auth/v1/user') return json({ id: userId, email: returnedEmail });
      if (url.pathname === '/rest/v1/rpc/is_admin') return json(admin);
      if (url.pathname === '/auth/v1/logout') return json({});
      throw new Error('Unexpected provider endpoint');
    },
  });
  function api(path: string, method = 'GET', body?: unknown, cookie = '') {
    return new Promise<{ status: number; data: Record<string, unknown>; cookie: string }>((resolve, reject) => {
      const jar = new Map(cookie.split('; ').filter(Boolean).map(value => value.split('=')) as [string, string][]);
      const req = { method, url: path, body, headers: { cookie, host: 'workspace.example', origin: 'https://workspace.example' }, ip: 'fixture-browser', secure: true, aborted: false,
        get(this: { headers: Record<string, string> }, name: string) { return this.headers[name.toLowerCase()]; },
      } as unknown as Request;
      let status = 200;
      const res = { destroyed: false, writableEnded: false,
        status(value: number) { status = value; return this; },
        set() { return this; },
        cookie(name: string, value: string, options: Record<string, unknown>) { assert.equal(options.httpOnly, true); assert.equal(options.sameSite, 'strict'); jar.set(name, value); return this; },
        json(this: { writableEnded: boolean }, data: Record<string, unknown>) { this.writableEnded = true; resolve({ status, data, cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') }); return this; },
      } as unknown as Response;
      connection.router(req, res, error => error ? reject(error) : reject(new Error('Route did not respond')));
    });
  }
  return { api, calls, advance: (ms: number) => { now += ms; }, admin: (value: boolean) => { admin = value; }, email: (value: string) => { returnedEmail = value; } };
}

test('email connection completes through the actual router without a network listener', async () => {
  const f = fixture();
  const browser = await f.api('/connections/mediasped/session');
  assert.equal((await f.api('/connections/mediasped/email/start', 'POST', { email }, browser.cookie)).status, 200);
  const connected = await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, browser.cookie);
  assert.equal(connected.status, 200); assert.equal(connected.data.authenticated, true); assert.equal(connected.data.admin, true);
  assert.equal(JSON.stringify(connected).includes(access), false);
  assert.equal(JSON.stringify(connected).includes('test-refresh-private'), false);
  assert.deepEqual(f.calls.find(call => call.path === '/auth/v1/otp')?.body, { email, create_user: false });
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, connected.cookie)).data.authenticated, true);
  assert.equal(f.calls.some(call => call.path.includes('blog_posts')), false);
});
test('email connection rejects another browser, an expired challenge and a canceled challenge', async () => {
  const f = fixture(); const browser = await f.api('/connections/mediasped/session');
  await f.api('/connections/mediasped/email/start', 'POST', { email }, browser.cookie);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' })).status, 401);
  f.advance(600001);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, browser.cookie)).status, 401);
  await f.api('/connections/mediasped/email/start', 'POST', { email }, browser.cookie);
  await f.api('/connections/mediasped/logout', 'POST', {}, browser.cookie);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, browser.cookie)).status, 401);
  assert.equal(f.calls.some(call => call.path === '/auth/v1/verify'), false);
});
test('email connection refuses a mismatching identity or non-administrator and revokes the candidate session', async () => {
  for (const denied of ['email', 'role']) {
    const f = fixture(); const browser = await f.api('/connections/mediasped/session');
    await f.api('/connections/mediasped/email/start', 'POST', { email }, browser.cookie);
    if (denied === 'email') f.email('someone-else@example.invalid'); else f.admin(false);
    const result = await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, browser.cookie);
    assert.equal(result.status, 401); assert.equal(result.data.authenticated, false);
    assert.ok(f.calls.some(call => call.path === '/auth/v1/logout'));
  }
});
