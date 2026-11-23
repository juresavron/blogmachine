import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseSections, readLiteralExport, upsertArray } from './source.js';
import type { ContentDraft, GitAdapter } from './types.js';

const contentPath = 'src/data/blog.ts';
const siteOrigin = 'https://logisticsworld.eu';
const plainText = z.string().refine(value => !value.includes('<'), 'Use plain text without HTML tags.');
const requiredText = plainText.refine(value => value.trim().length > 0, 'This field is required.');
const slug = z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens for the slug.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a publication date in YYYY-MM-DD format.').refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date.');
const source = z.object({
  label: requiredText,
  url: z.string().url().refine(value => {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  }, 'Source links must use HTTPS without embedded credentials.'),
});
const metadataSchema = z.object({
  category: z.enum(['Slovenia', 'Ocean freight', 'Planning']),
  artwork: z.enum(['port', 'containers', 'checklist']),
  takeaway: requiredText,
  publishedAt: date,
  sources: z.array(source).max(100).optional(),
}).strict();
const draftSchema = z.object({ title: requiredText, slug, excerpt: requiredText, content: requiredText });
const articleSchema = z.object({
  slug,
  title: requiredText,
  description: requiredText,
  category: metadataSchema.shape.category,
  artwork: metadataSchema.shape.artwork,
  publishedAt: date,
  takeaway: requiredText,
  sections: z.array(z.object({ id: slug, title: requiredText, paragraphs: z.array(requiredText).min(1), items: z.array(requiredText).optional() })).min(1),
  sources: z.array(source),
}).refine(article => new Set(article.sections.map(section => section.id)).size === article.sections.length, 'Section anchor IDs must be unique.');

function articlesFrom(sourceText: string) {
  const articles = z.array(articleSchema).parse(readLiteralExport(sourceText, 'blogPosts'));
  if (new Set(articles.map(article => article.slug)).size !== articles.length) throw new Error('The article catalog contains duplicate slugs. Resolve them before preparing content.');
  return articles;
}

function checkTarget(targetKey: string) {
  if (targetKey !== 'main') throw new Error('Unknown LogisticsWorld target. Choose main.');
}

function sectionId(value: string, index: number, used: Set<string>) {
  const base = value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 175).replace(/-$/, '') || `section-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

function makeArticle(input: ContentDraft, metadata: Record<string, unknown>) {
  const draft = draftSchema.parse(input);
  const settings = metadataSchema.parse(metadata);
  const usedIds = new Set<string>();
  const sections = parseSections(draft.content).map((section, index) => {
    const title = section.heading.trim() || draft.title;
    return { id: sectionId(title, index, usedIds), title, paragraphs: section.paragraphs };
  });
  return articleSchema.parse({
    slug: draft.slug, title: draft.title, description: draft.excerpt,
    category: settings.category, artwork: settings.artwork, publishedAt: settings.publishedAt,
    takeaway: settings.takeaway, sections, sources: settings.sources ?? [],
  });
}

export const logistiscworldAdapter: GitAdapter = {
  id: 'logistiscworld',
  targets: [{ key: 'main', label: 'LogisticsWorld', url: siteOrigin, locale: 'en', contentPath }],
  async list(root, targetKey) {
    checkTarget(targetKey);
    const text = await readFile(join(root, contentPath), 'utf8');
    return articlesFrom(text).map(article => ({ slug: article.slug, title: article.title, description: article.description, url: `${siteOrigin}/blog/${article.slug}` }));
  },
  async prepare(root, targetKey, draft, metadata) {
    checkTarget(targetKey);
    const before = await readFile(join(root, contentPath), 'utf8');
    const existing = articlesFrom(before).find(article => article.slug === draft.slug);
    const article = makeArticle(draft, metadata.sources === undefined && existing ? { ...metadata, sources: existing.sources } : metadata);
    const after = upsertArray(before, 'blogPosts', [], article);
    articlesFrom(after);
    return { relativePath: contentPath, before, after, articleUrl: `${siteOrigin}/blog/${article.slug}` };
  },
};
