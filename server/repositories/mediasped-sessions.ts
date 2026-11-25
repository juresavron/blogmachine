import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { databaseEnvironment } from './environment.js';
import { mediaspedConfiguration, mediaspedProjectUrl, testMediaspedConnection } from './mediasped.js';

const COOKIE = 'bm_mediasped_session';
const CLIENT_COOKIE = 'bm_mediasped_client';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MARKER_TTL = 365 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN = 60_000;
const RATE_WINDOW = 15 * 60 * 1000;
const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(1024) }).strict();
const tokenSchema = z.object({ access_token: z.string().min(1).max(16_384), refresh_token: z.string().min(1).max(16_384), expires_in: z.number().int().positive().max(86_400) });
type Tokens = z.infer<typeof tokenSchema>;
interface EmailChallenge { email: string; expiresAt: number; }
interface BrowserSession { clientId: string; accessToken: string; refreshToken: string; tokenExpiresAt: number; expiresAt: number; checking?: Promise<void>; }
export interface MediaspedSessionStatus {
  authenticated: boolean; admin: boolean; source: 'browser' | 'environment' | 'none'; expiresAt?: string; message: string;
}
class SessionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const disconnected = (message = 'Mediašped is disconnected. Connect your administrator account to continue.'): MediaspedSessionStatus => ({ authenticated: false, admin: false, source: 'none', message });

export function createMediaspedSessions(options: { workspace: string; env: NodeJS.ProcessEnv; request?: typeof fetch; now?: () => number; repositoryRoot?: (id: string) => Promise<string> }) {
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, BrowserSession>();
  const pendingLogins = new Map<string, string>();
  const emailChallenges = new Map<string, EmailChallenge>();
  const loginAttempts = new Map<string, number[]>();
  let globalAttempts: number[] = [];
  const router = Router();
  const opaqueId = () => randomBytes(32).toString('hex');
  function cookie(req: Request, name = COOKIE) {
    const found = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    // Duplicate or malformed markers fail closed instead of selecting another identity.
    if (found.length !== 1) return found.length ? '' : undefined;
    const value = found[0]!.slice(name.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  }
  function setMarker(req: Request, res: Response, id = opaqueId(), name = COOKIE) {
    // A browser's same-origin HTTPS Origin also covers a TLS-terminating proxy.
    // Never trust forwarded-protocol headers or enable blanket trust proxy.
    let secure = req.secure;
    try { const origin = new URL(req.get('origin') ?? ''); secure ||= origin.protocol === 'https:' && origin.host === req.get('host'); } catch { /* Ordinary local HTTP requests do not carry an HTTPS origin. */ }
    res.cookie(name, id, { httpOnly: true, sameSite: 'strict', secure, path: '/api', maxAge: MARKER_TTL });
  }
  function markClient(req: Request, res: Response) {
    const clientId = cookie(req, CLIENT_COOKIE) || opaqueId();
    setMarker(req, res, clientId, CLIENT_COOKIE);
    return clientId;
  }
  function forget(id: string | undefined) { if (id) sessions.delete(id); }
  function forgetClient(clientId: string) {
    pendingLogins.delete(clientId);
    emailChallenges.delete(clientId);
    for (const [id, session] of sessions) if (session.clientId === clientId) sessions.delete(id);
  }
  function current(id: string, session: BrowserSession) {
    if (sessions.get(id) !== session || session.expiresAt <= now()) {
      if (sessions.get(id) === session) sessions.delete(id);
      throw new SessionError(401, 'Your Mediašped connection expired or was disconnected. Connect your account again.');
    }
  }
  function prune() {
    for (const [client, challenge] of emailChallenges) if (challenge.expiresAt <= now()) emailChallenges.delete(client);
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    for (const [client, attempts] of loginAttempts) {
      const recent = attempts.filter(time => time > now() - RATE_WINDOW);
      if (recent.length) loginAttempts.set(client, recent); else loginAttempts.delete(client);
    }
  }
  function rateLimit(client: string) {
    prune();
    globalAttempts = globalAttempts.filter(time => time > now() - RATE_WINDOW);
    const attempts = loginAttempts.get(client) ?? [];
    if (attempts.length >= 10 || globalAttempts.length >= 30) throw new SessionError(429, 'Too many connection attempts. Wait a few minutes before trying again.');
    globalAttempts.push(now()); loginAttempts.set(client, [...attempts, now()]);
  }
  async function environment() { return databaseEnvironment('mediasped', options.workspace, options.env, options.repositoryRoot); }
  async function authRequest(path: string, key: string, body?: unknown, token?: string) {
    return request(`${mediaspedProjectUrl}/auth/v1/${path}`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
  }
  async function revoke(accessToken: string, key: string) {
    // Local scope avoids logging out other browsers or the website's own sessions.
    try { await authRequest('logout?scope=local', key, undefined, accessToken); } catch { /* Local revocation always wins, even when upstream is unavailable. */ }
  }
  async function verify(env: NodeJS.ProcessEnv, accessToken: string) {
    const result = await testMediaspedConnection({ ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: accessToken }, request);
    if (!result.authenticated || !result.admin) throw new SessionError(401, 'Your Mediašped connection could not be verified. Connect an administrator account again.');
  }
  async function ensure(id: string, session: BrowserSession, env: NodeJS.ProcessEnv) {
    current(id, session);
    if (session.checking) { await session.checking; current(id, session); return; }
    const checking = (async () => {
      try {
        if (session.tokenExpiresAt <= now() + REFRESH_MARGIN) {
          const { key } = mediaspedConfiguration(env, false);
          const response = await authRequest('token?grant_type=refresh_token', key, { refresh_token: session.refreshToken });
          if (!response.ok) throw new Error('Refresh failed');
          const tokens = tokenSchema.parse(await response.json());
          current(id, session);
          session.accessToken = tokens.access_token;
          session.refreshToken = tokens.refresh_token;
          session.tokenExpiresAt = now() + tokens.expires_in * 1000;
        }
        await verify(env, session.accessToken);
        current(id, session);
      } catch {
        forget(id);
        throw new SessionError(401, 'Your Mediašped connection expired or could not be verified. Connect your account again.');
      }
    })();
    session.checking = checking;
    try { await checking; } finally { if (session.checking === checking) session.checking = undefined; }
    current(id, session);
  }
  function browserStatus(session: BrowserSession): MediaspedSessionStatus {
    return { authenticated: true, admin: true, source: 'browser', expiresAt: new Date(session.expiresAt).toISOString(), message: 'Your Mediašped administrator account is connected. Drafts remain unpublished.' };
  }
  async function status(req: Request): Promise<MediaspedSessionStatus> {
    prune();
    const id = cookie(req);
    if (id !== undefined) {
      const session = sessions.get(id);
      if (!session) return disconnected();
      try { await ensure(id, session, await environment()); return browserStatus(session); }
      catch { return disconnected('Your Mediašped connection expired or could not be verified. Connect your account again.'); }
    }
    const result = await testMediaspedConnection(await environment(), request);
    return result.authenticated && result.admin
      ? { authenticated: true, admin: true, source: 'environment', message: 'A server-configured Mediašped administrator session is available. Connect your account to use a browser-specific session.' }
      : disconnected('Connect your Mediašped administrator account to save website drafts.');
  }
  async function resolve(req: Request): Promise<{ env: NodeJS.ProcessEnv; request: typeof fetch }> {
    const env = await environment();
    const id = cookie(req);
    if (id === undefined) return { env, request };
    const session = sessions.get(id);
    if (!session) throw new SessionError(401, 'Connect your Mediašped administrator account to continue.');
    await ensure(id, session, env);
    const accessToken = session.accessToken;
    const guardedRequest: typeof fetch = async (input, init) => {
      current(id, session);
      if (session.accessToken !== accessToken) throw new SessionError(401, 'Your Mediašped session changed. Retry this action.');
      return request(input, init);
    };
    return { env: { ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: accessToken }, request: guardedRequest };
  }

  router.get('/connections/mediasped/session', async (req, res) => {
    markClient(req, res);
    try { res.json(await status(req)); } catch { res.json(disconnected('Could not check the Mediašped connection. Try again.')); }
  });
  router.post('/connections/mediasped/login', async (req, res) => {
    const previous = cookie(req);
    const clientId = cookie(req, CLIENT_COOKIE);
    const attempt = opaqueId();
    let candidate: Tokens | undefined;
    let key: string | undefined;
    try {
      rateLimit(req.ip ?? 'local');
      if (!clientId) { markClient(req, res); throw new SessionError(428, 'Refresh the Mediašped connection status before signing in.'); }
      forgetClient(clientId);
      pendingLogins.set(clientId, attempt);
      const input = credentialsSchema.safeParse(req.body);
      req.body = undefined;
      if (!input.success) throw new SessionError(400, 'Enter a valid email and password.');
      forget(previous);
      const env = await environment();
      try { key = mediaspedConfiguration(env, false).key; } catch { throw new SessionError(503, 'The Mediašped connection is not configured on this server.'); }
      const response = await authRequest('token?grant_type=password', key, input.data);
      if (!response.ok) throw new Error('Login failed');
      candidate = tokenSchema.parse(await response.json());
      await verify(env, candidate.access_token);
      if (pendingLogins.get(clientId) !== attempt || req.aborted || res.destroyed) throw new SessionError(401, 'This connection attempt was canceled. Connect your account again.');
      prune();
      if (sessions.size >= 100) throw new SessionError(503, 'The connection service is busy. Try again later.');
      const id = opaqueId();
      const session: BrowserSession = { clientId, accessToken: candidate.access_token, refreshToken: candidate.refresh_token, tokenExpiresAt: now() + candidate.expires_in * 1000, expiresAt: now() + SESSION_TTL };
      sessions.set(id, session);
      markClient(req, res);
      setMarker(req, res, id);
      res.json(browserStatus(session));
    } catch (error) {
      req.body = undefined;
      // A superseded response must not overwrite the newer login/logout cookie.
      const ownsAttempt = !clientId || pendingLogins.get(clientId) === attempt;
      if (ownsAttempt) { forget(previous); setMarker(req, res); }
      const code = error instanceof SessionError && [400, 428, 429, 503].includes(error.status) ? error.status : 401;
      const message = error instanceof SessionError && [400, 428, 429, 503].includes(error.status) ? error.message : 'Could not connect. Check your login and Mediašped administrator access.';
      if (code === 429) res.set('Retry-After', '900');
      res.status(code).json({ ...disconnected(message), error: message });
      if (candidate && key) void revoke(candidate.access_token, key);
    } finally {
      if (clientId && pendingLogins.get(clientId) === attempt) pendingLogins.delete(clientId);
    }
  });
  router.post('/connections/mediasped/email/start', async (req, res) => {
    const clientId = cookie(req, CLIENT_COOKIE);
    try {
      rateLimit(req.ip ?? 'local');
      if (!clientId) { markClient(req, res); throw new SessionError(428, 'Refresh your connection status before signing in.'); }
      const input = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(req.body);
      req.body = undefined;
      if (!input.success) throw new SessionError(400, 'Enter your existing Mediašped account email.');
      forgetClient(clientId);
      const challenge = { email: input.data.email, expiresAt: now() + 10 * 60 * 1000 };
      emailChallenges.set(clientId, challenge);
      const { key } = mediaspedConfiguration(await environment(), false);
      // Existing accounts only. This never creates an account or changes a password.
      const response = await authRequest('otp', key, { email: challenge.email, create_user: false });
      if (!response.ok || emailChallenges.get(clientId) !== challenge) throw new SessionError(503, 'Email sign-in is unavailable. Try again later or use your existing password.');
      res.json({ sent: true, message: 'If this existing account supports email sign-in, check its inbox for the sign-in link or code.' });
    } catch (error) {
      req.body = undefined;
      const code = error instanceof SessionError ? error.status : 503;
      res.status(code).json({ error: error instanceof SessionError ? error.message : 'Could not request email sign-in. Try again later.' });
    }
  });
  router.post('/connections/mediasped/email/verify', async (req, res) => {
    const previous = cookie(req);
    const clientId = cookie(req, CLIENT_COOKIE);
    const attempt = opaqueId();
    let candidate: Tokens | undefined, key: string | undefined;
    try {
      rateLimit(req.ip ?? 'local');
      const challenge = clientId ? emailChallenges.get(clientId) : undefined;
      if (!clientId || !challenge || challenge.expiresAt <= now()) throw new SessionError(401, 'Request a new email sign-in link from this browser.');
      const input = z.object({ proof: z.string().trim().min(1).max(4000) }).strict().safeParse(req.body);
      req.body = undefined;
      if (!input.success) throw new SessionError(400, 'Enter the sign-in code or original Supabase sign-in link.');
      const proof = mediaspedEmailProof(input.data.proof, challenge.email);
      pendingLogins.set(clientId, attempt);
      const env = await environment();
      key = mediaspedConfiguration(env, false).key;
      const response = await authRequest('verify', key, proof);
      if (!response.ok) throw new SessionError(401, 'The email sign-in link or code is invalid or expired. Request a new one.');
      const payload: unknown = await response.json();
      candidate = tokenSchema.parse(payload);
      const account = z.object({ user: z.object({ email: z.string().email() }) }).parse(payload);
      if (account.user.email.toLowerCase() !== challenge.email.toLowerCase()) throw new SessionError(401, 'Use the sign-in email for the account you requested.');
      await verify(env, candidate.access_token);
      if (pendingLogins.get(clientId) !== attempt || emailChallenges.get(clientId) !== challenge || req.aborted || res.destroyed) throw new SessionError(401, 'This connection attempt was canceled.');
      prune();
      if (sessions.size >= 100) throw new SessionError(503, 'The connection service is busy. Try again later.');
      const id = opaqueId();
      const session: BrowserSession = { clientId, accessToken: candidate.access_token, refreshToken: candidate.refresh_token, tokenExpiresAt: now() + candidate.expires_in * 1000, expiresAt: now() + SESSION_TTL };
      sessions.set(id, session);
      emailChallenges.delete(clientId);
      markClient(req, res); setMarker(req, res, id);
      res.json(browserStatus(session));
    } catch (error) {
      req.body = undefined;
      const code = error instanceof SessionError && [400, 401, 429, 503].includes(error.status) ? error.status : 401;
      const message = error instanceof SessionError ? error.message : 'Could not verify email sign-in and administrator access.';
      res.status(code).json({ ...disconnected(message), error: message });
      if (candidate && key) void revoke(candidate.access_token, key);
    } finally {
      if (clientId && pendingLogins.get(clientId) === attempt) pendingLogins.delete(clientId);
    }
  });
  router.post('/connections/mediasped/logout', async (req, res) => {
    const id = cookie(req);
    const session = id ? sessions.get(id) : undefined;
    const clientId = markClient(req, res);
    forgetClient(clientId);
    if (session) forgetClient(session.clientId);
    forget(id);
    setMarker(req, res);
    // Send the local disconnect immediately. Waiting for provider revocation
    // would let a delayed logout response overwrite a newer browser login.
    res.json(disconnected());
    if (session) {
      void (async () => {
        try { const { key } = mediaspedConfiguration(await environment(), false); await revoke(session.accessToken, key); } catch { /* Browser stays disconnected independently of server configuration. */ }
      })();
    }
  });
  // Repository error handling recognizes this without ever reflecting provider errors.
  return { router, status, resolve };
}
export type MediaspedSessions = ReturnType<typeof createMediaspedSessions>;
export function mediaspedSessionError(error: unknown) {
  return error instanceof SessionError ? { status: error.status, message: error.message } : undefined;
}


/** Accept a code or a link from this exact provider; never fetch a pasted URL. */
export function mediaspedEmailProof(proof: string, email: string): { email: string; token: string; type: 'email' } | { token_hash: string; type: 'email' } {
  if (/^\d{6,10}$/.test(proof)) return { email, token: proof, type: 'email' };
  let url: URL;
  try { url = new URL(proof); } catch { throw new SessionError(400, 'Enter the sign-in code or original Supabase sign-in link.'); }
  const token = url.searchParams.get('token') ?? url.searchParams.get('token_hash');
  if (url.origin !== mediaspedProjectUrl || url.username || url.password || url.pathname !== '/auth/v1/verify' || !['email', 'magiclink'].includes(url.searchParams.get('type') ?? '') || !token || !/^[a-zA-Z0-9_-]{20,256}$/.test(token)) throw new SessionError(400, 'Use the original Mediašped Supabase sign-in link from your email.');
  return { token_hash: token, type: 'email' };
}
