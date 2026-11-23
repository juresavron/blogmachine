/// <reference types="@cloudflare/workers-types" />
import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '../app.js';
import { createD1Store } from './store.js';
import { configureHostedSessions } from './sessions.js';
import { githubRepositorySource } from './repositories.js';
import { useHostedRepositorySource } from '../repositories/files.js';
import { githubConnection } from './github-connection.js';
// Generated from the frontend production build; never contains runtime secrets.
// @ts-expect-error generated module exists only during the hosted build
import assets from '../../.hosted-build/assets.js';

const bindings = env as unknown as { DB: D1Database; SESSION_ENCRYPTION_KEY: string; [key: string]: unknown };
configureHostedSessions(bindings.DB, bindings.SESSION_ENCRYPTION_KEY);
const github = githubConnection(bindings.DB, bindings.SESSION_ENCRYPTION_KEY);
useHostedRepositorySource(githubRepositorySource(github.credential));
const runtimeEnv = Object.fromEntries(Object.entries(bindings).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
const workerFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error('Redirects are not allowed for authenticated connections.');
  return response;
};
const { app } = createApp({ store: createD1Store(bindings.DB), env: runtimeEnv, repositoriesWorkspace: '/repositories', repositoriesRequest: workerFetch, googleRequest: (url, init) => workerFetch(url, { ...init, signal: AbortSignal.timeout(20_000) }) });
app.listen(3001);
const handler = httpServerHandler({ port: 3001 });

export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties>, _env: unknown, ctx: ExecutionContext) {
    // Sites supplies this trusted identity after enforcing owner-only access.
    // This check also prevents accidental unprotected hosting of this Worker.
    if (!request.headers.get('oai-authenticated-user-id')) return Response.json({ error: 'Sign in to your ChatGPT account to open Blog Machine.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!bindings.DB || !bindings.SESSION_ENCRYPTION_KEY) return Response.json({ error: 'Hosted storage is not configured.' }, { status: 503 });
      const githubRoute = url.pathname === '/api/hosting/github';
      if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return githubRoute ? github.handle(request) : handler.fetch!(request, bindings, ctx);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({error:'Cross-origin requests are not allowed.'},{status:403,headers:{'Cache-Control':'no-store'}});
      const owner = crypto.randomUUID();
      const lock = await bindings.DB.prepare('INSERT INTO operation_locks(id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE operation_locks.expires_at<? RETURNING owner').bind('write',owner,Date.now()+300_000,Date.now()).first();
      if (!lock) return Response.json({ error: 'Another change is being saved. Try again in a moment.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      try { return await (githubRoute ? github.handle(request) : handler.fetch!(request, bindings, ctx)); }
      finally { await bindings.DB.prepare('DELETE FROM operation_locks WHERE id=? AND owner=?').bind('write',owner).run(); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = assets[path] ?? (!url.pathname.includes('.') ? assets['/index.html'] : undefined);
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), char => char.charCodeAt(0)), { headers: { 'Content-Type': asset.type, 'Cache-Control': path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex, nofollow' } });
  },
};
