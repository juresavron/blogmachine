import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ArticleSummary, ContentDraft, RepoTarget } from './types.js';

export const venueProjectUrl = 'https://ytdjrgvqsyrinuwrnzbj.supabase.co';
// Public API identifier. Authority remains with the existing public RPC and RLS.
const publishableKey = "sb_publishable_uzP-cBnf-uxVu5f3oMuhHg_sDF_jnXJ";
// Existing publicly served company identities, verified against the platform registry.
const venues = [
  {
    "id": "60e85d3d-0d20-4fe8-80d1-2dcf8e7e7cdb",
    "name": "Al Mulin",
    "site": "si",
    "url": "https://al-mulin.si"
  },
  {
    "id": "2955db87-9304-4f4b-a035-39e7f3e2ea43",
    "name": "Anna's Garden",
    "site": "hr",
    "url": "https://ocjenagor.com/book/2955db87-9304-4f4b-a035-39e7f3e2ea43"
  },
  {
    "id": "a503dc0e-3026-49fb-9866-714d5af83c50",
    "name": "Bazilkata",
    "site": "si",
    "url": "https://ocenagor.com/book/a503dc0e-3026-49fb-9866-714d5af83c50"
  },
  {
    "id": "d6c19c66-c616-4d36-843b-f25c36a0f0e1",
    "name": "Beach Volley Bar",
    "site": "si",
    "url": "https://beachvolleybarkoper.si"
  },
  {
    "id": "c993de6a-e73c-4af1-9d71-1c273ef0986a",
    "name": "Bife Museum",
    "site": "si",
    "url": "https://bifemuseum.si"
  },
  {
    "id": "a052e89d-1b57-46a4-8a59-0a9d245bb2dc",
    "name": "Bistro Burja",
    "site": "si",
    "url": "https://bistroburja.si"
  },
  {
    "id": "41c7a227-bac6-41e1-9935-43410e431d99",
    "name": "Cafe Bar Pri Pomolu",
    "site": "si",
    "url": "https://ocenagor.com/book/41c7a227-bac6-41e1-9935-43410e431d99"
  },
  {
    "id": "8fc70401-4523-4d85-8119-e6c37f002d2f",
    "name": "Casa Popo",
    "site": "si",
    "url": "https://ocenagor.com/book/8fc70401-4523-4d85-8119-e6c37f002d2f"
  },
  {
    "id": "09c2617e-ee1d-472f-b4eb-92e05e602eb4",
    "name": "Divino Caffe",
    "site": "si",
    "url": "https://divino-caffe.si"
  },
  {
    "id": "a86ec867-00c5-4c7e-b92f-34079406af73",
    "name": "Fizialis",
    "site": "si",
    "url": "https://fizialis.si"
  },
  {
    "id": "f207e7b8-0732-4671-aa5d-e3472b1eca0a",
    "name": "Gostilna pri hrastu",
    "site": "si",
    "url": "https://ocenagor.com/book/f207e7b8-0732-4671-aa5d-e3472b1eca0a"
  },
  {
    "id": "0df01085-f37d-435d-ac81-2b07d8174412",
    "name": "Gostilnica Gušt",
    "site": "si",
    "url": "https://gostilnicagust.si"
  },
  {
    "id": "6d03d71d-034e-4344-a919-4a8f13d9771c",
    "name": "Jure",
    "site": "si",
    "url": "https://ocenagor.com/book/6d03d71d-034e-4344-a919-4a8f13d9771c"
  },
  {
    "id": "c4701a79-b7ae-4bc8-ba6c-6e1551bd9de4",
    "name": "Martin Racing",
    "site": "si",
    "url": "https://ocenagor.com/book/c4701a79-b7ae-4bc8-ba6c-6e1551bd9de4"
  },
  {
    "id": "259948c9-7529-48cb-9071-9bc51245cb24",
    "name": "Nomos",
    "site": "si",
    "url": "https://ocenagor.com/book/259948c9-7529-48cb-9071-9bc51245cb24"
  },
  {
    "id": "b3e4c506-da86-4130-8664-c1b0013e8399",
    "name": "Pizzerija Atrij",
    "site": "si",
    "url": "https://ocenagor.com/book/b3e4c506-da86-4130-8664-c1b0013e8399"
  },
  {
    "id": "e4dba753-cba3-4971-ad25-295fc709515c",
    "name": "Pr Hostar Gostilna",
    "site": "si",
    "url": "https://ocenagor.com/book/e4dba753-cba3-4971-ad25-295fc709515c"
  },
  {
    "id": "66e1ce67-d7ed-4772-95f1-4c7a20979a23",
    "name": "Restavracija Bazilika",
    "site": "si",
    "url": "https://bazilikakp.com"
  },
  {
    "id": "1809f1c9-073f-4a24-aa3c-a92a38a40020",
    "name": "Rifugio Bar",
    "site": "si",
    "url": "https://rifugiobar.si"
  },
  {
    "id": "752f9489-9c3e-452e-898c-309ac3ec6fc4",
    "name": "Salon Bernarda",
    "site": "si",
    "url": "https://ocenagor.com/book/752f9489-9c3e-452e-898c-309ac3ec6fc4"
  },
  {
    "id": "3f67d387-0b2c-48e0-ae09-14488898fd5c",
    "name": "Salon Moj Svet",
    "site": "si",
    "url": "https://ocenagor.com/book/3f67d387-0b2c-48e0-ae09-14488898fd5c"
  },
  {
    "id": "a49cd8be-7c60-47c0-a43c-1529510ae689",
    "name": "Stati kaštel",
    "site": "hr",
    "url": "https://ocjenagor.com/book/a49cd8be-7c60-47c0-a43c-1529510ae689"
  },
  {
    "id": "cbaf07da-4800-4685-96f2-562117390c68",
    "name": "Vesuvio",
    "site": "si",
    "url": "https://ocenagor.com/book/cbaf07da-4800-4685-96f2-562117390c68"
  }
];

export const venueTargets: RepoTarget[] = venues.map(venue => ({ key: venue.id, label: venue.name, url: venue.url, locale: venue.site === 'hr' ? 'hr' : venue.site === 'it' ? 'it' : 'sl', contentPath: 'public.tenant_blog_posts' }));

function targetFor(key: string) {
  const target = venueTargets.find(target => target.key === key);
  if (!target) throw new Error('Choose an existing OcenaGor customer website.');
  return target;
}
export async function listVenueArticles(key: string, request: typeof fetch = fetch): Promise<ArticleSummary[]> {
  const target = targetFor(key);
  const query = new URLSearchParams({ p_company_id: target.key, p_page: '1' });
  let response: Response;
  try { response = await request(`${venueProjectUrl}/rest/v1/rpc/tenant_blog_public?${query}`, { method: 'GET', headers: { apikey: publishableKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
  catch { throw new Error('Could not reach the customer blog API. Try again later.'); }
  if (!response.ok) throw new Error(`The customer blog API returned HTTP ${response.status}. Published content access could not be verified.`);
  const data: unknown = await response.json().catch(() => { throw new Error('The customer blog response was not recognized.'); });
  // The existing public RPC returns null for an unavailable blog or no articles.
  if (data === null) return [];
  const result = z.object({ base: z.string().url(), articles: z.array(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(96), title: z.string(), excerpt: z.string() })).max(25) }).safeParse(data);
  if (!result.success || result.data.base.replace(/\/$/, '') !== target.url) throw new Error('The customer blog identity changed. Refresh its verified website mapping before preparing content.');
  return result.data.articles.map(article => ({ slug: article.slug, title: article.title, description: article.excerpt, url: `${target.url}/blog/${article.slug}` }));
}
export function prepareVenueDraft(draft: ContentDraft, key: string, id = randomUUID()) {
  const target = targetFor(key);
  const plain = z.string().trim().refine(value => !value.includes('<'), 'Use plain text.');
  const value = z.object({ title: plain.pipe(z.string().min(3).max(130)), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(96), excerpt: plain.pipe(z.string().min(10).max(280)), content: plain.pipe(z.string().min(40).max(16_000)) }).strict().parse(draft);
  return { id: z.uuid().parse(id), company_id: target.key, topic: value.title, brief: '', language: target.locale, slug: value.slug, title: value.title, excerpt: value.excerpt, body: value.content, destination: 'website', partner_company_id: null, partner_context: '', status: 'draft', approved_at: null, published_at: null };
}
