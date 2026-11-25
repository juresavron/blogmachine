import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../app.js';

const project = 'https://ytmowbzkpofeeocgevyr.supabase.co';
const userId = '91833161-d600-4a3d-b6b0-c72f6352fb1b';
const jwt = (label: string) => `fixture.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', label })).toString('base64url')}.signature`;
const environmentToken = jwt('environment-private');
const accessToken = jwt('browser-private');
const rotatedAccess = jwt('rotated-private');
const password = 'private-fixture-password';
const refreshToken = 'private-refresh-token';
const nextRefresh = 'private-rotated-refresh';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext, ambient = true) {
  let clock = Date.UTC(2026, 10, 23, 12);
  const controls = { admin: true, loginAccepted: true, identityAccepted: true, refreshAccepted: true, expiresIn: 3600, logoutFails: false, loginGate: undefined as Promise<void> | undefined, refreshGate: undefined as Promise<void> | undefined, logoutGate: undefined as Promise<void> | undefined, onLogin: undefined as (() => void) | undefined, onRefresh: undefined as (() => void) | undefined, onLogout: undefined as (() => void) | undefined };
  const calls: { url: URL; init: RequestInit }[] = [];
  const request: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    assert.equal(url.origin, project);
    calls.push({ url, init });
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        controls.onLogin?.();
        const gate = controls.loginGate;
        if (gate) await gate;
        if (!controls.loginAccepted) return json({ error: `upstream may echo ${password}` }, 400);
        return json({ access_token: accessToken, refresh_token: refreshToken, expires_in: controls.expiresIn });
      }
      assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
      assert.equal(JSON.parse(String(init.body)).refresh_token, refreshToken);
      controls.onRefresh?.();
      const gate = controls.refreshGate;
      if (gate) await gate;
      if (!controls.refreshAccepted) return json({ error: nextRefresh }, 401);
      return json({ access_token: rotatedAccess, refresh_token: nextRefresh, expires_in: 3600 });
    }
    if (url.pathname === '/auth/v1/otp') return controls.loginAccepted ? json({}) : json({ error: password }, 400);
    if (url.pathname === '/auth/v1/verify') return controls.loginAccepted ? json({ access_token: accessToken, refresh_token: refreshToken, expires_in: controls.expiresIn, user: { email: 'admin@example.invalid' } }) : json({ error: password }, 400);
    if (url.pathname === '/auth/v1/user') return controls.identityAccepted ? json({ id: userId, email: 'private@example.invalid' }) : json({ error: accessToken }, 401);
    if (url.pathname === '/rest/v1/rpc/is_admin') { assert.deepEqual(JSON.parse(String(init.body)), { _user_id: userId }); return json(controls.admin); }
    if (url.pathname === '/auth/v1/logout') {
      assert.equal(url.searchParams.get('scope'), 'local');
      controls.onLogout?.();
      const gate = controls.logoutGate;
      if (gate) await gate;
      if (controls.logoutFails) throw new Error('private logout diagnostic');
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fixture operation: ${url.pathname}`);
  };
  const { app, store } = createApp({ databasePath: ':memory:', seed: false, repositoriesWorkspace: '/tmp/no-such-website-checkout', repositoriesRequest: request, repositoriesSessionNow: () => clock,
    env: { MEDIASPED_SUPABASE_URL: project, MEDIASPED_SUPABASE_ANON_KEY: 'public-fixture-key', ...(ambient ? { MEDIASPED_SUPABASE_ACCESS_TOKEN: environmentToken } : {}) },
  });
  const server: Server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  async function api(path: string, method = 'GET', body?: unknown, cookie = '', headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie(), response };
  }
  function mergeCookies(previous: string, values: string[]) {
    const jar = new Map(previous.split('; ').filter(Boolean).map(part => { const index = part.indexOf('='); return [part.slice(0, index), part.slice(index + 1)]; }));
    for (const value of values) { const first = value.split(';')[0]!; const index = first.indexOf('='); jar.set(first.slice(0, index), first.slice(index + 1)); }
    return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  }
  async function login(previous = '', headers: Record<string, string> = {}) {
    const status = await api('/connections/mediasped/session', 'GET', undefined, previous);
    const client = mergeCookies(previous, status.cookies);
    const result = await api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, client, headers);
    return { ...result, cookie: mergeCookies(client, result.cookies) };
  }
  const tokens = [accessToken, rotatedAccess, environmentToken, refreshToken, nextRefresh, password, 'private@example.invalid'];
  function noSecrets(value: unknown) { for (const secret of tokens) assert.equal(JSON.stringify(value).includes(secret), false); }
  return { api, login, mergeCookies, calls, controls, noSecrets, store, base, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

test('normal account sign-in keeps credentials on the server and uses an opaque HttpOnly cookie', async t => {
  const f = await fixture(t, false);
  const signedIn = await f.login();
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.data.authenticated, true);
  assert.equal(signedIn.data.admin, true);
  assert.equal(signedIn.data.source, 'browser');
  assert.equal(Date.parse(signedIn.data.expiresAt), f.now() + 8 * 60 * 60 * 1000);
  const cookie = signedIn.cookies.find(value => value.startsWith('bm_mediasped_session='))!;
  assert.match(cookie, /^bm_mediasped_session=[a-f0-9]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
  assert.equal(cookie.includes('Secure'), false);
  f.noSecrets(signedIn.data); f.noSecrets(signedIn.cookies);
  const status = await f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie);
  assert.equal(status.data.source, 'browser'); f.noSecrets(status.data);
  const rows = f.store.db.prepare('SELECT data FROM repository_changes').all(); f.noSecrets(rows);
  const tokenCall = f.calls.find(call => call.url.searchParams.get('grant_type') === 'password')!;
  assert.deepEqual(JSON.parse(String(tokenCall.init.body)), { email: 'admin@example.invalid', password });
  assert.equal(f.calls.some(call => call.url.pathname === '/rest/v1/blog_posts'), false);
});

test('only verified administrator accounts connect; errors do not echo credentials or identify accounts', async t => {
  const f = await fixture(t);
  f.controls.loginAccepted = false;
  const wrongPassword = await f.login();
  assert.equal(wrongPassword.status, 401); f.noSecrets(wrongPassword.data);
  f.controls.loginAccepted = true; f.controls.admin = false;
  const notAdmin = await f.login();
  assert.equal(notAdmin.status, 401);
  assert.equal(notAdmin.data.error, wrongPassword.data.error);
  assert.equal(notAdmin.data.authenticated, false); f.noSecrets(notAdmin.data);
  assert.ok(f.calls.some(call => call.url.pathname === '/auth/v1/logout' && call.url.search === '?scope=local'));
});

test('first sign-in without a browser marker is refused before exchanging credentials', async t => {
  const f = await fixture(t);
  const response = await f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password });
  assert.equal(response.status, 428);
  assert.equal(f.calls.length, 0);
  assert.ok(response.cookies.some(value => value.startsWith('bm_mediasped_client=')));
});

test('no-cookie headless requests retain environment mode; browser logout blocks fallback and isolates other clients', async t => {
  const f = await fixture(t);
  const ambient = await f.api('/connections/mediasped/session');
  assert.equal(ambient.data.source, 'environment');
  const first = await f.login();
  const second = await f.login();
  const logout = await f.api('/connections/mediasped/logout', 'POST', undefined, first.cookie);
  const disconnectedCookie = f.mergeCookies(first.cookie, logout.cookies);
  assert.equal(logout.data.source, 'none');
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, disconnectedCookie)).data.authenticated, false);
  assert.equal((await f.api('/repositories/mediasped/test-connection', 'POST', undefined, disconnectedCookie)).data.authenticated, false);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, second.cookie)).data.source, 'browser');
  assert.equal((await f.api('/connections/mediasped/session')).data.source, 'environment');
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, 'bm_mediasped_session=unknown')).data.source, 'none');
});

test('concurrent requests serialize refresh rotation and keep tokens out of responses', async t => {
  const f = await fixture(t);
  const signedIn = await f.login();
  f.advance(3_550_000);
  const gate = deferred(), started = deferred();
  f.controls.refreshGate = gate.promise; f.controls.onRefresh = started.resolve;
  const one = f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie);
  await started.promise;
  const two = f.api('/repositories/mediasped/test-connection', 'POST', undefined, signedIn.cookie);
  gate.resolve();
  const results = await Promise.all([one, two]);
  assert.equal(results.every(result => result.data.authenticated === true), true);
  assert.equal(f.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token').length, 1);
  const latestIdentity = f.calls.filter(call => call.url.pathname === '/auth/v1/user').at(-1)!;
  assert.equal(new Headers(latestIdentity.init.headers).get('Authorization'), `Bearer ${rotatedAccess}`);
  for (const result of results) f.noSecrets(result.data);
});

test('failed refresh, administrator removal, and absolute expiry revoke browser access without env fallback', async t => {
  const f = await fixture(t);
  let signedIn = await f.login();
  f.advance(3_550_000); f.controls.refreshAccepted = false;
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie)).data.source, 'none');
  f.controls.refreshAccepted = true;
  signedIn = await f.login(); f.controls.admin = false;
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie)).data.authenticated, false);
  f.controls.admin = true;
  signedIn = await f.login(); f.advance(8 * 60 * 60 * 1000 + 1);
  const callsBefore = f.calls.length;
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie)).data.source, 'none');
  assert.equal(f.calls.length, callsBefore);
});

test('a refresh completing after logout cannot restore the revoked browser session', async t => {
  const f = await fixture(t);
  const signedIn = await f.login();
  f.advance(3_550_000);
  const gate = deferred(), started = deferred();
  f.controls.refreshGate = gate.promise; f.controls.onRefresh = started.resolve;
  const pending = f.api('/connections/mediasped/session', 'GET', undefined, signedIn.cookie);
  await started.promise;
  const logout = await f.api('/connections/mediasped/logout', 'POST', undefined, signedIn.cookie);
  gate.resolve();
  assert.equal((await pending).data.authenticated, false);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, f.mergeCookies(signedIn.cookie, logout.cookies))).data.source, 'none');
});

test('a delayed login cannot reconnect a browser after logout or supersede a newer login', async t => {
  const f = await fixture(t);
  const signedIn = await f.login();
  const gate = deferred(), started = deferred();
  f.controls.loginGate = gate.promise; f.controls.onLogin = started.resolve;
  const pending = f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, signedIn.cookie);
  await started.promise;
  const logout = await f.api('/connections/mediasped/logout', 'POST', undefined, signedIn.cookie);
  gate.resolve();
  const late = await pending;
  assert.equal(late.status, 401);
  assert.equal(late.cookies.some(cookie => cookie.startsWith('bm_mediasped_session=')), false);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, f.mergeCookies(signedIn.cookie, late.cookies))).data.source, 'none');
  assert.equal(logout.data.authenticated, false);

  const nextGate = deferred(), nextStarted = deferred();
  f.controls.loginGate = nextGate.promise; f.controls.onLogin = nextStarted.resolve;
  const oldAttempt = f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, signedIn.cookie);
  await nextStarted.promise;
  f.controls.loginGate = undefined; f.controls.onLogin = undefined;
  const newAttempt = await f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, signedIn.cookie);
  assert.equal(newAttempt.status, 200);
  nextGate.resolve();
  const superseded = await oldAttempt;
  assert.equal(superseded.status, 401);
  assert.equal(superseded.cookies.some(cookie => cookie.startsWith('bm_mediasped_session=')), false);
  const currentCookie = f.mergeCookies(signedIn.cookie, newAttempt.cookies);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, currentCookie)).data.source, 'browser');
});

test('cookie security accepts same-origin HTTPS but never blindly trusts forwarded headers', async t => {
  const f = await fixture(t);
  const host = new URL(f.base).host;
  const secure = await f.login('', { Origin: `https://${host}` });
  assert.match(secure.cookies.find(value => value.startsWith('bm_mediasped_session='))!, /; Secure/);
  const spoofed = await f.login('', { 'X-Forwarded-Proto': 'https' });
  assert.equal(spoofed.cookies.find(value => value.startsWith('bm_mediasped_session='))!.includes('Secure'), false);
  const hostile = await f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, secure.cookie, { Origin: 'https://other.example' });
  assert.equal(hostile.status, 403);
});

test('delayed provider revocation cannot delay old failure/logout cookies past a newer successful login', async t => {
  const f = await fixture(t);
  let signedIn = await f.login();
  const logoutGate = deferred(), logoutStarted = deferred();
  f.controls.logoutGate = logoutGate.promise; f.controls.onLogout = logoutStarted.resolve;
  try {
    const pendingLogout = f.api('/connections/mediasped/logout', 'POST', undefined, signedIn.cookie);
    await logoutStarted.promise;
    const logout = await Promise.race([pendingLogout, new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), 500).unref(); })]);
    assert.ok(logout, 'Local logout must complete before provider revocation finishes.');
    const disconnectedCookie = f.mergeCookies(signedIn.cookie, logout.cookies);
    signedIn = await f.login(disconnectedCookie);
    assert.equal(signedIn.data.source, 'browser');
  } finally { logoutGate.resolve(); }

  const failureGate = deferred(), failureStarted = deferred();
  f.controls.logoutGate = failureGate.promise; f.controls.onLogout = failureStarted.resolve; f.controls.admin = false;
  try {
    const failedLogin = f.api('/connections/mediasped/login', 'POST', { email: 'admin@example.invalid', password }, signedIn.cookie);
    await failureStarted.promise;
    const failure = await Promise.race([failedLogin, new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), 500).unref(); })]);
    assert.ok(failure, 'A failed login response must complete before provider revocation finishes.');
    assert.equal(failure.status, 401);
    f.controls.admin = true;
    const newest = await f.login(f.mergeCookies(signedIn.cookie, failure.cookies));
    assert.equal(newest.data.source, 'browser');
    failureGate.resolve();
    assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, newest.cookie)).data.source, 'browser');
  } finally { failureGate.resolve(); }
});

test('login attempts are bounded and upstream logout failure still disconnects locally', async t => {
  const f = await fixture(t);
  const signedIn = await f.login(); f.controls.logoutFails = true;
  const logout = await f.api('/connections/mediasped/logout', 'POST', undefined, signedIn.cookie);
  assert.equal(logout.status, 200);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, f.mergeCookies(signedIn.cookie, logout.cookies))).data.source, 'none');
  f.controls.loginAccepted = false;
  for (let attempt = 0; attempt < 9; attempt++) await f.login();
  const limited = await f.login();
  assert.equal(limited.status, 429);
  assert.equal(limited.response.headers.get('Retry-After'), '900');
  f.noSecrets(limited.data);
});


test('email sign-in uses existing accounts only and connects a verified administrator without exposing tokens', async t => {
  const f = await fixture(t, false);
  const status = await f.api('/connections/mediasped/session');
  let cookie = f.mergeCookies('', status.cookies);
  const start = await f.api('/connections/mediasped/email/start', 'POST', { email: 'admin@example.invalid' }, cookie);
  assert.equal(start.status, 200); assert.equal(start.data.sent, true); f.noSecrets(start.data);
  const otpCall = f.calls.find(call => call.url.pathname === '/auth/v1/otp')!;
  assert.deepEqual(JSON.parse(String(otpCall.init.body)), { email: 'admin@example.invalid', create_user: false });
  const proof = `${project}/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink&redirect_to=https%3A%2F%2Fmediasped.com`;
  const connected = await f.api('/connections/mediasped/email/verify', 'POST', { proof }, cookie);
  assert.equal(connected.status, 200); assert.equal(connected.data.admin, true); f.noSecrets(connected.data); f.noSecrets(connected.cookies);
  const verifyCall = f.calls.find(call => call.url.pathname === '/auth/v1/verify')!;
  assert.deepEqual(JSON.parse(String(verifyCall.init.body)), { token_hash: 'a'.repeat(64), type: 'email' });
  cookie = f.mergeCookies(cookie, connected.cookies);
  assert.equal((await f.api('/connections/mediasped/session', 'GET', undefined, cookie)).data.authenticated, true);
  assert.equal(f.calls.some(call => call.url.pathname === '/rest/v1/blog_posts'), false);
});

test('email challenges are browser-bound, expire, and are canceled by logout', async t => {
  const f = await fixture(t, false);
  const status = await f.api('/connections/mediasped/session');
  const cookie = f.mergeCookies('', status.cookies);
  await f.api('/connections/mediasped/email/start', 'POST', { email: 'admin@example.invalid' }, cookie);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' })).status, 401);
  f.advance(10 * 60 * 1000 + 1);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, cookie)).status, 401);
  await f.api('/connections/mediasped/email/start', 'POST', { email: 'admin@example.invalid' }, cookie);
  await f.api('/connections/mediasped/logout', 'POST', {}, cookie);
  assert.equal((await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, cookie)).status, 401);
  assert.equal(f.calls.some(call => call.url.pathname === '/auth/v1/verify'), false);
});

test('email verification still requires the existing administrator role', async t => {
  const f = await fixture(t, false); f.controls.admin = false;
  const status = await f.api('/connections/mediasped/session');
  const cookie = f.mergeCookies('', status.cookies);
  await f.api('/connections/mediasped/email/start', 'POST', { email: 'admin@example.invalid' }, cookie);
  const result = await f.api('/connections/mediasped/email/verify', 'POST', { proof: '123456' }, cookie);
  assert.equal(result.status, 401); assert.equal(result.data.authenticated, false); f.noSecrets(result.data);
  assert.ok(f.calls.some(call => call.url.pathname === '/auth/v1/logout'));
});

test('email verification refuses unrelated and credential-bearing provider links before sending them', async () => {
  const { mediaspedEmailProof } = await import('./mediasped-sessions.js');
  assert.deepEqual(mediaspedEmailProof('123456', 'admin@example.invalid'), { email: 'admin@example.invalid', token: '123456', type: 'email' });
  for (const proof of [
    `https://evil.example/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink`,
    `https://user:password@ytmowbzkpofeeocgevyr.supabase.co/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink`,
    `${project}/auth/v1/verify?token=${'a'.repeat(64)}&type=recovery`,
    `${project}/auth/v1/verify?token=short&type=magiclink`,
  ]) assert.throws(() => mediaspedEmailProof(proof, 'admin@example.invalid'));
});
