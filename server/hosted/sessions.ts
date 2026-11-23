import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { databaseEnvironment } from '../repositories/environment.js';
import { mediaspedConfiguration, mediaspedProjectUrl, testMediaspedConnection } from '../repositories/mediasped.js';

const COOKIE = 'bm_mediasped_session';
const CLIENT = 'bm_mediasped_client';
const TTL = 8 * 60 * 60_000;
type Session = { clientId: string; accessToken: string; refreshToken: string; tokenExpiresAt: number; expiresAt: number };
type Status = { authenticated: boolean; admin: boolean; source: 'browser' | 'none'; expiresAt?: string; message: string };
class SessionError extends Error { constructor(public status: number, message: string) { super(message); } }
const disconnected = (message = 'Connect your Mediašped administrator account to save website drafts.'): Status => ({ authenticated: false, admin: false, source: 'none', message });
let config: { db: D1Database; key: string };
export function configureHostedSessions(db: D1Database, key: string) { config = { db, key }; }
const opaque = () => randomBytes(32).toString('hex');

export async function encryptSession(session: Session, secret: string, id: string) {
  const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode(JSON.stringify(session)));
  return Buffer.concat([iv, Buffer.from(body)]).toString('base64');
}
export async function decryptSession(data: string, secret: string, id: string): Promise<Session> {
  const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), 'AES-GCM', false, ['decrypt']);
  const bytes = Buffer.from(data, 'base64');
  const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(id) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(body));
}
function cookie(req: Request, name: string) {
  const parts = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  if (parts.length !== 1) return undefined;
  const value = parts[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
function marker(res: Response, name: string, value: string) { res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api', maxAge: TTL }); }
function client(req: Request, res: Response) { const id = cookie(req, CLIENT) ?? opaque(); marker(res, CLIENT, id); return id; }
const browserStatus = (session: Session): Status => ({ authenticated: true, admin: true, source: 'browser', expiresAt: new Date(session.expiresAt).toISOString(), message: 'Your Mediašped administrator account is connected. Drafts remain unpublished.' });

export function createMediaspedSessions(options: { workspace: string; env: NodeJS.ProcessEnv; request?: typeof fetch; now?: () => number }) {
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  const db = config.db;
  const secret = config.key;
  const router = Router();
  const environment = () => databaseEnvironment('mediasped', options.workspace, options.env);
  async function auth(path: string, key: string, body?: unknown, token?: string) {
    return request(`${mediaspedProjectUrl}/auth/v1/${path}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  }
  async function verify(env: NodeJS.ProcessEnv, token: string) {
    const result = await testMediaspedConnection({ ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: token }, request);
    if (!result.authenticated || !result.admin) throw new SessionError(401, 'Connect a Mediašped administrator account to continue.');
  }
  async function removeClient(clientId: string, attempt: string) {
    await db.batch([
      db.prepare('INSERT INTO connector_clients(id,attempt) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET attempt=excluded.attempt').bind(clientId, attempt),
      db.prepare('DELETE FROM connector_sessions WHERE client_id=?').bind(clientId),
    ]);
  }
  async function current(id: string, version: number) {
    const row = await db.prepare('SELECT version FROM connector_sessions WHERE id=? AND expires_at>?').bind(id, now()).first<{ version: number }>();
    if (!row || row.version !== version) throw new SessionError(401, 'Your Mediašped connection changed. Connect your account again.');
  }
  async function resolve(req: Request) {
    const id = cookie(req, COOKIE);
    if (!id) throw new SessionError(401, 'Connect your Mediašped administrator account to continue.');
    let row = await db.prepare('SELECT data,version FROM connector_sessions WHERE id=? AND expires_at>?').bind(id, now()).first<{ data: string; version: number }>();
    if (!row) throw new SessionError(401, 'Your Mediašped connection expired. Connect your account again.');
    const env = await environment();
    let session: Session;
    try { session = await decryptSession(row.data, secret, id); } catch { throw new SessionError(401, 'Connect your Mediašped account again.'); }
    if (session.clientId !== cookie(req, CLIENT)) throw new SessionError(401, 'Connect your Mediašped account in this browser.');
    if (session.tokenExpiresAt <= now() + 60_000) {
      const owner = opaque();
      const lock = await db.prepare('INSERT INTO operation_locks(id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE operation_locks.expires_at<? RETURNING owner').bind(`refresh:${id}`, owner, now() + 30_000, now()).first();
      if (!lock) throw new SessionError(409, 'The connection is refreshing. Try again in a moment.');
      try {
        row = await db.prepare('SELECT data,version FROM connector_sessions WHERE id=? AND expires_at>?').bind(id, now()).first<{ data: string; version: number }>();
        if (!row) throw new SessionError(401, 'Connect your Mediašped account again.');
        session = await decryptSession(row.data, secret, id);
        if (session.tokenExpiresAt <= now() + 60_000) {
          const { key } = mediaspedConfiguration(env, false);
          const response = await auth('token?grant_type=refresh_token', key, { refresh_token: session.refreshToken });
          if (!response.ok) throw new SessionError(401, 'Your Mediašped connection expired. Connect your account again.');
          const tokens = tokenSchema.parse(await response.json());
          session = { ...session, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: now() + tokens.expires_in * 1000 };
          const saved = await db.prepare('UPDATE connector_sessions SET data=?,version=version+1 WHERE id=? AND version=? RETURNING version').bind(await encryptSession(session, secret, id), id, row.version).first<{ version: number }>();
          if (!saved) throw new SessionError(401, 'This connection was disconnected.');
          row = { data: '', version: saved.version };
        }
      } finally { await db.prepare('DELETE FROM operation_locks WHERE id=? AND owner=?').bind(`refresh:${id}`, owner).run(); }
    }
    await verify(env, session.accessToken);
    const version = row.version;
    await current(id, version);
    const guarded: typeof fetch = async (input, init) => { await current(id, version); return request(input, init); };
    return { session, env: { ...env, MEDIASPED_SUPABASE_ACCESS_TOKEN: session.accessToken }, request: guarded };
  }
  async function status(req: Request): Promise<Status> {
    try { return browserStatus((await resolve(req)).session); }
    catch (error) { if (error instanceof SessionError && error.status === 409) throw error; return disconnected(); }
  }
  router.get('/connections/mediasped/session', async (req, res) => { client(req,res); res.json(await status(req)); });
  const tokenSchema = z.object({ access_token: z.string().min(1).max(16_384), refresh_token: z.string().min(1).max(16_384), expires_in: z.number().int().positive().max(86_400) });
  router.post('/connections/mediasped/login', async (req, res) => {
    const clientId = cookie(req, CLIENT);
    if (!clientId) { client(req,res); return res.status(428).json({ error: 'Refresh the connection status before signing in.' }); }
    const attempt = opaque();
    let candidate: z.infer<typeof tokenSchema> | undefined;
    let key: string | undefined;
    let saved = false;
    try {
      const result = await db.batch([
        db.prepare('DELETE FROM login_attempts WHERE created_at<?').bind(now() - 15 * 60_000),
        db.prepare('INSERT INTO login_attempts(id,created_at) VALUES (?,?)').bind(opaque(), now()),
        db.prepare('SELECT count(*) AS count FROM login_attempts'),
        db.prepare('DELETE FROM connector_sessions WHERE expires_at<=?').bind(now()),
      ]);
      if ((result[2].results[0] as { count: number }).count > 30) throw new SessionError(429, 'Too many connection attempts. Wait 15 minutes.');
      const input = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(1024) }).strict().safeParse(req.body);
      req.body = undefined;
      if (!input.success) throw new SessionError(400, 'Enter a valid email and password.');
      await removeClient(clientId, attempt);
      const env = await environment();
      key = mediaspedConfiguration(env, false).key;
      const response = await auth('token?grant_type=password', key, input.data);
      if (!response.ok) throw new SessionError(401, 'Could not connect. Check your login and Mediašped administrator access.');
      candidate = tokenSchema.parse(await response.json());
      await verify(env, candidate.access_token);
      const id = opaque();
      const session: Session = { clientId, accessToken: candidate.access_token, refreshToken: candidate.refresh_token, tokenExpiresAt: now() + candidate.expires_in * 1000, expiresAt: now() + TTL };
      const inserted = await db.prepare('INSERT INTO connector_sessions(id,client_id,data,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM connector_clients WHERE id=? AND attempt=?) RETURNING id').bind(id, clientId, await encryptSession(session,secret,id),session.expiresAt,clientId,attempt).first();
      if (!inserted) throw new SessionError(401, 'This connection attempt was canceled. Try again.');
      saved = true; marker(res, COOKIE, id); res.json(browserStatus(session));
    } catch (error) {
      req.body = undefined;
      if (error instanceof SessionError) { if (error.status === 429) res.set('Retry-After','900'); res.status(error.status).json({ error:error.message, ...disconnected(error.message) }); }
      else res.status(401).json({ error:'Could not connect. Check your login and Mediašped administrator access.' });
    } finally {
      if (!saved && candidate && key) { try { await auth('logout?scope=local',key,undefined,candidate.access_token); } catch { /* Provider cleanup never restores access. */ } }
    }
  });
  router.post('/connections/mediasped/logout', async (req, res) => {
    const clientId = client(req,res);
    await removeClient(clientId, opaque());
    marker(res, COOKIE, opaque());
    res.json(disconnected());
  });
  return { router, status, resolve };
}
export function mediaspedSessionError(error: unknown) { return error instanceof SessionError ? { status:error.status, message:error.message } : undefined; }
