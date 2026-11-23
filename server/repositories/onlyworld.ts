import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { parseSections, readLiteralExport, upsertArray } from './source.js';
import type { ContentDraft, GitAdapter, RepoTarget } from './types.js';

const markets = [
  ['at', 'Austria', 'osterreichfans.com', 'de-AT'],
  ['au', 'Australia', 'australia-fans.com', 'en-AU'],
  ['ba', 'Bosnia and Herzegovina', 'bosnafans.com', 'bs-BA'],
  ['be', 'Belgium', 'belgique-fans.com', 'fr-BE'],
  ['ch', 'Switzerland', 'schweizfans.com', 'de-CH'],
  ['cz', 'Czechia', 'ceskofans.com', 'cs-CZ'],
  ['de', 'Germany', 'deutschland-fans.com', 'de-DE'],
  ['dk', 'Denmark', 'danmarkfans.com', 'da-DK'],
  ['es', 'Spain', 'espanolafans.com', 'es-ES'],
  ['fi', 'Finland', 'suomi-fans.com', 'fi-FI'],
  ['fr', 'France', 'france-fans.com', 'fr-FR'],
  ['gb', 'United Kingdom', 'uk-fans.com', 'en-GB'],
  ['gr', 'Greece', 'greecefans.com', 'el-GR'],
  ['hr', 'Croatia', 'hrvatskafans.com', 'hr-HR'],
  ['ie', 'Ireland', 'irelandfans.com', 'en-IE'],
  ['it', 'Italy', 'italiafans.com', 'it-IT'],
  ['mx', 'Mexico', 'mexico-fans.com', 'es-MX'],
  ['nl', 'Netherlands', 'nederlandfans.com', 'nl-NL'],
  ['no', 'Norway', 'norge-fans.com', 'nb-NO'],
  ['nz', 'New Zealand', 'newzealandfans.com', 'en-NZ'],
  ['pl', 'Poland', 'polskafans.com', 'pl-PL'],
  ['pt', 'Portugal', 'portugal-fans.com', 'pt-PT'],
  ['rs', 'Serbia', 'srbijafans.com', 'sr-RS'],
  ['sct', 'Scotland', 'scotlandfans.com', 'en-GB'],
  ['se', 'Sweden', 'sverigefans.com', 'sv-SE'],
] as const;

const targets: RepoTarget[] = markets.map(([key, label, domain, locale]) => ({
  key, label, url: `https://${domain}`, locale,
  contentPath: `src/tenants/content/blog/${key}.ts`,
}));

const directoryLinks = ['/creators', '/cities', '/free', '/best', '/new'] as const;
const slugSchema = z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Article slugs must use lowercase words separated by hyphens or underscores.');
const sectionSchema = z.object({ heading: z.string().min(1), paragraphs: z.array(z.string()).min(1) }).passthrough();
const articleSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  directoryLink: z.enum(directoryLinks),
  cities: z.array(slugSchema).optional(),
  sections: z.array(sectionSchema).min(1),
}).passthrough();
const blogSchema = z.object({ title: z.string(), description: z.string(), posts: z.array(articleSchema) }).passthrough();
const textOnly = (limit: number) => z.string().trim().min(1).max(limit).refine(value => !value.includes('<'), 'Use plain text without HTML or "<" characters.');
const draftSchema = z.object({
  title: textOnly(250),
  slug: z.string().trim().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens for the slug.'),
  excerpt: textOnly(1000),
  content: textOnly(200_000),
});
const metadataSchema = z.object({
  directoryLink: z.enum(directoryLinks),
  cities: z.array(slugSchema).max(30).optional(),
}).strict();

function targetFor(key: string) {
  const target = targets.find(item => item.key === key);
  if (!target) throw new Error('Unknown Onlyworld market. Choose one of the 25 configured country websites.');
  return target;
}

async function readSource(root: string, relativePath: string) {
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(resolve(canonicalRoot, relativePath));
  const inside = relative(canonicalRoot, canonicalFile);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\')) {
    throw new Error('Onlyworld content must stay inside the selected repository.');
  }
  return readFile(canonicalFile, 'utf8');
}

function parseBlog(source: string) {
  const parsed = blogSchema.safeParse(readLiteralExport(source, 'blog'));
  if (!parsed.success) throw new Error(`The Onlyworld blog export has an unsupported article schema: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}.`);
  return parsed.data;
}

async function validateCities(root: string, market: string, cities: string[]) {
  if (!cities.length) return;
  const source = await readSource(root, 'src/tenants/cities.ts');
  const registry = z.record(z.string(), z.array(z.object({ slug: z.string(), name: z.string() }))).parse(readLiteralExport(source, 'CITIES'));
  const allowed = new Set(registry[market]?.map(city => city.slug) ?? []);
  const unknown = cities.filter(city => !allowed.has(city));
  if (unknown.length) throw new Error(`Choose city slugs from the ${market} market's city registry. Unknown cities: ${unknown.join(', ')}.`);
}

export const onlyworldAdapter: GitAdapter = {
  id: 'onlyworld',
  targets,
  async list(root, targetKey) {
    const target = targetFor(targetKey);
    const blog = parseBlog(await readSource(root, target.contentPath));
    return blog.posts.map(({ slug, title, description }) => ({
      slug, title, description, url: `${target.url}/blog/${slug}`,
    }));
  },
  async prepare(root, targetKey, input: ContentDraft, metadata) {
    const target = targetFor(targetKey);
    const draft = draftSchema.parse(input);
    const fields = metadataSchema.parse(metadata);
    const before = await readSource(root, target.contentPath);
    const blog = parseBlog(before);
    const previous = blog.posts.find(post => post.slug === draft.slug);
    if (fields.cities !== undefined) await validateCities(root, targetKey, fields.cities);
    const article = {
      ...previous,
      slug: draft.slug,
      title: draft.title,
      description: draft.excerpt,
      directoryLink: fields.directoryLink,
      sections: parseSections(draft.content).map(section => ({ ...section, heading: section.heading || draft.title })),
      ...(fields.cities !== undefined ? { cities: [...new Set(fields.cities)] } : {}),
    };
    articleSchema.parse(article);
    const after = upsertArray(before, 'blog', ['posts'], article);
    // Validate the emitted source before handing it to the repository hub.
    parseBlog(after);
    return { relativePath: target.contentPath, before, after, articleUrl: `${target.url}/blog/${draft.slug}` };
  },
};
