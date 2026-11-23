import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ArticleSummary, ContentDraft, RepoTarget } from './types.js';

/** These describe the inspected source branch, not observed production state. */
export const trgovinaTargets: (RepoTarget & { sourceLive: boolean })[] = [
  { key: 'bazen', label: 'Masažni bazeni Vrelec', url: 'https://masaznibazenivrelec.si', locale: 'sl-SI', contentPath: '/blog', sourceLive: true },
  { key: 'vrecke', label: 'Kofeinske vrečke Zagon', url: 'https://kofeinskevreckezagon.si', locale: 'sl-SI', contentPath: '/blog', sourceLive: false },
];

const contentSchema = z.object({
  title: z.string().trim().min(1).max(250),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase slug with hyphens.').max(200),
  excerpt: z.string().trim().max(1000),
  content: z.string().max(200_000),
}).strict();

export interface TrgovinaDraftPayload {
  id: string;
  shop_id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: { source: string };
  cover_url: null;
  cover_alt: '';
  status: 'draft';
  published_at: null;
}

function targetFor(key: string) {
  const target = trgovinaTargets.find(target => target.key === key);
  if (!target) throw new Error('Unknown Trgovina shop. Choose bazen or vrecke.');
  return target;
}

/** Prepare an export only. This module never creates or updates remote rows. */
export function prepareTrgovinaDraft(draft: ContentDraft, targetKey: string, id: string = randomUUID()): TrgovinaDraftPayload {
  const target = targetFor(targetKey);
  const parsed = contentSchema.parse(draft);
  const stableId = z.uuid('Use a valid UUID for the prepared draft.').parse(id);
  return {
    id: stableId,
    shop_id: target.key,
    slug: parsed.slug,
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: { source: parsed.content },
    cover_url: null,
    cover_alt: '',
    status: 'draft',
    published_at: null,
  };
}

type TrgovinaEnv = Record<string, string | undefined>;
export type TrgovinaRequest = (url: string, init: RequestInit) => Promise<Response>;
export interface TrgovinaConnection {
  configured: boolean;
  authenticated: boolean;
  admin: boolean;
  message: string;
}

function isServiceRoleCredential(value: string | undefined) {
  if (!value) return false;
  if (value.startsWith('sb_secret_')) return true;
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload === 'object' && payload !== null && 'role' in payload && payload.role === 'service_role';
  } catch { return false; }
}
function configuration(env: TrgovinaEnv) {
  const rawUrl = env.TRGOVINA_SUPABASE_URL?.trim();
  const key = env.TRGOVINA_SUPABASE_ANON_KEY;
  const token = env.TRGOVINA_SUPABASE_ACCESS_TOKEN;
  if (!rawUrl || !key) throw new Error('Set TRGOVINA_SUPABASE_URL and TRGOVINA_SUPABASE_ANON_KEY on the server.');
  if (isServiceRoleCredential(key) || isServiceRoleCredential(token)) {
    throw new Error('Service-role credentials are not supported. Use a project publishable key and a signed-in administrator access token.');
  }
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Use the canonical HTTPS Supabase project URL in TRGOVINA_SUPABASE_URL.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TRGOVINA_SUPABASE_URL must be a canonical HTTPS *.supabase.co project URL without credentials, a custom path, port, query, or fragment.');
  }
  return { origin: url.origin, key, token };
}
function requestOptions(headers: Record<string, string>, method: 'GET' | 'POST' = 'GET'): RequestInit {
  return { method, headers, redirect: 'error', signal: AbortSignal.timeout(15_000), ...(method === 'POST' ? { body: '{}' } : {}) };
}

/** Identity and existing is_admin RPC checks only; neither publishes content. */
export async function testTrgovinaConnection(env: TrgovinaEnv, request: TrgovinaRequest = fetch): Promise<TrgovinaConnection> {
  let config: ReturnType<typeof configuration>;
  try { config = configuration(env); } catch (cause) {
    return { configured: false, authenticated: false, admin: false, message: cause instanceof Error ? cause.message : 'Trgovina server configuration is incomplete.' };
  }
  if (!config.token) return { configured: false, authenticated: false, admin: false, message: 'Set TRGOVINA_SUPABASE_ACCESS_TOKEN on the server to verify an authenticated admin connection. The publishable key alone cannot authorize publishing.' };
  const headers = { apikey: config.key, Authorization: `Bearer ${config.token}`, Accept: 'application/json' };
  try {
    const identity = await request(`${config.origin}/auth/v1/user`, requestOptions(headers));
    if (!identity.ok) return { configured: true, authenticated: false, admin: false, message: 'Supabase did not verify this access token. Check its validity and project. No content was changed.' };
    if (!z.object({ id: z.uuid() }).safeParse(await identity.json()).success) {
      return { configured: true, authenticated: false, admin: false, message: 'Supabase returned an unrecognized identity. Authentication remains unverified. No content was changed.' };
    }
  } catch {
    return { configured: true, authenticated: false, admin: false, message: 'Could not verify the Supabase identity. Check network access and the access token. No content was changed.' };
  }
  try {
    const response = await request(`${config.origin}/rest/v1/rpc/is_admin`, requestOptions({ ...headers, 'Content-Type': 'application/json' }, 'POST'));
    if (!response.ok) return { configured: true, authenticated: true, admin: false, message: 'Identity verified, but admin access could not be checked. No content was changed.' };
    const admin = await response.json();
    if (typeof admin !== 'boolean') return { configured: true, authenticated: true, admin: false, message: 'Identity verified, but Supabase returned an unrecognized admin check. Admin access remains unverified. No content was changed.' };
    return { configured: true, authenticated: true, admin, message: admin
      ? 'Supabase identity and admin membership verified. This was a read-only connection check; no content was changed.'
      : 'Supabase identity verified, but this account is not on the admin allowlist. No content was changed.' };
  } catch {
    return { configured: true, authenticated: true, admin: false, message: 'Identity verified, but the admin check could not be completed. Check network access and permissions. No content was changed.' };
  }
}

/** Read published rows only, always filtered to a known shop. No token is required for public reads. */
export async function listTrgovinaArticles(targetKey: string, env: TrgovinaEnv, request: TrgovinaRequest = fetch): Promise<ArticleSummary[]> {
  const target = targetFor(targetKey);
  const config = configuration(env);
  const query = new URLSearchParams({ shop_id: `eq.${target.key}`, status: 'eq.published', select: 'id,slug,title,excerpt', order: 'published_at.desc', limit: '100' });
  const headers: Record<string, string> = { apikey: config.key, Accept: 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response: Response;
  try { response = await request(`${config.origin}/rest/v1/posts?${query.toString()}`, requestOptions(headers)); }
  catch { throw new Error('Could not read Trgovina articles. Check Supabase configuration and network access.'); }
  if (!response.ok) throw new Error('Supabase did not permit reading published Trgovina articles. Check project configuration and permissions.');
  let rows: { slug: string; title: string; excerpt: string }[];
  try {
    rows = z.array(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200), title: z.string(), excerpt: z.string() })).parse(await response.json());
  } catch { throw new Error('Supabase returned an unrecognized article list.'); }
  return rows.map(row => ({ slug: row.slug, title: row.title, description: row.excerpt, url: `${target.url}${target.contentPath}/${row.slug}` }));
}
