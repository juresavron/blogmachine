import { readFile, realpath, stat } from './files.js';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { parseSections, readLiteralExport, readLiteralVariable, upsertArray, upsertObjectProperty } from './source.js';
import type { ContentDraft, GitAdapter, RepoTarget } from './types.js';

const contentPath = 'src/content/blog/sl.ts';
const imagesPath = 'src/content/blog/images.ts';
export const ocenagorCategories = ['Google profil', 'Google ocene', 'NFC komponente', 'Digitalni meni', 'AI telefonist', 'Rezervacije miz', 'Rezervacije terminov', 'Spletne strani'] as const;
export const ocenagorIcons = ['profile', 'reviews', 'nfc', 'reply'] as const;
const target: RepoTarget = {
  key: 'si', label: 'Ocenagor.si · Slovenia', url: 'https://ocenagor.si', locale: 'sl', contentPath,
  additionalPaths: [imagesPath],
};
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !value.includes('<'), 'Use plain text without HTML or literal < characters.');
const slugSchema = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens for the slug.');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a real YYYY-MM-DD date.').refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real YYYY-MM-DD date.');
const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use an HTTPS URL without credentials.');
const localLink = z.string().refine(value => {
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\<>\s]/.test(value)) return true;
  return httpsUrl.safeParse(value).success;
}, 'Use an absolute HTTPS URL or an internal path.');
const sourceSchema = z.object({ label: plainText(500), href: httpsUrl }).strict();
const ctaSchema = z.object({ title: plainText(1000), text: plainText(5000), label: plainText(500), href: localLink }).passthrough();
const sectionSchema = z.object({
  id: slugSchema, title: z.string().min(1), paragraphs: z.array(z.string()),
  links: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
  bullets: z.array(z.string()).optional(), ordered: z.boolean().optional(),
  example: z.object({ label: z.string(), text: z.string() }).optional(),
  photo: z.object({ src: z.string(), alt: z.string(), caption: z.string() }).optional(),
}).passthrough();
const articleSchema = z.object({
  slug: slugSchema, title: z.string().min(1), seoTitle: z.string().min(1), primaryKeyword: z.string().min(1),
  description: z.string().min(1), category: z.enum(ocenagorCategories), icon: z.enum(ocenagorIcons),
  published: dateSchema, updated: dateSchema.optional(), imageAlt: z.string().optional(), takeaway: z.string().min(1),
  sections: z.array(sectionSchema).min(1), sources: z.array(sourceSchema), cta: ctaSchema,
  leadOffer: z.object({ variant: z.string(), label: z.string(), items: z.string(), yearly: z.string(), monthly: z.string() }).passthrough().optional(),
}).passthrough();
const draftSchema = z.object({ title: plainText(250), slug: slugSchema, excerpt: plainText(1000), content: plainText(200_000) });
const metadataFields = {
  category: z.enum(ocenagorCategories), icon: z.enum(ocenagorIcons), publishedAt: dateSchema,
  primaryKeyword: plainText(500), takeaway: plainText(5000), ctaTemplateSlug: slugSchema, imageSourceSlug: slugSchema,
  sources: z.array(sourceSchema).max(30),
};
const metadataSchema = z.object(metadataFields).partial().strict();
const newMetadataSchema = metadataSchema.required({ category: true, icon: true, publishedAt: true, primaryKeyword: true, takeaway: true, ctaTemplateSlug: true, imageSourceSlug: true });
const assetPath = z.string().regex(/^\/images\/blog\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/, 'Choose an existing blog image asset.').refine(value => value.split('/').every((part, index) => index === 0 || (part !== '' && part !== '.' && part !== '..')), 'Image assets must stay in the blog image directory.');
const imageSchema = z.object({
  src: assetPath, small: assetPath, share: assetPath, alt: plainText(2000),
  author: z.string().optional(), provider: z.string().optional(), source: httpsUrl.optional(),
  venue: z.string().optional(), license: httpsUrl.optional(), published: dateSchema.optional(), productImage: z.boolean().optional(),
}).passthrough();

function assertTarget(key: string) {
  if (key !== 'si') throw new Error('The Ocenagor connector currently supports Slovenian content only. Croatian and Italian articles need their own translation adapter.');
}
async function containedPath(root: string, file: string) {
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(resolve(canonicalRoot, file));
  const local = relative(canonicalRoot, canonicalFile);
  if (isAbsolute(local) || local === '..' || local.startsWith('../') || local.startsWith('..\\')) throw new Error('Ocenagor content and image assets must stay inside the selected repository.');
  return canonicalFile;
}
async function readSource(root: string, file: string) {
  return readFile(await containedPath(root, file), 'utf8');
}
function readPosts(source: string) {
  const posts = z.array(articleSchema).min(1).parse(readLiteralExport(source, 'BLOG_POSTS'));
  if (new Set(posts.map(post => post.slug)).size !== posts.length) throw new Error('Resolve duplicate Ocenagor article slugs before preparing content.');
  return posts;
}
function readImages(source: string) {
  return z.record(z.string(), imageSchema).parse(readLiteralVariable(source, 'BLOG_IMAGES'));
}
function sectionsFor(draft: ContentDraft) {
  const usedIds = new Set<string>();
  return parseSections(draft.content).map((section, index) => {
    const title = section.heading.trim() || draft.title;
    const stem = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 170).replace(/-$/, '') || `section-${index + 1}`;
    let id = stem;
    let suffix = 2;
    while (usedIds.has(id)) id = `${stem}-${suffix++}`;
    usedIds.add(id);
    return { id, title, paragraphs: section.paragraphs };
  });
}
async function validateImageAssets(root: string, image: z.infer<typeof imageSchema>) {
  for (const path of [image.src, image.small, image.share]) {
    const file = await containedPath(root, `public${path}`);
    if (!(await stat(file)).isFile()) throw new Error('The selected blog image must point to existing image files.');
  }
}

export async function getOcenagorImageChoices(root: string): Promise<{ slug: string; alt: string; src: string }[]> {
  const images = readImages(await readSource(root, imagesPath));
  return Object.entries(images).map(([slug, image]) => ({ slug, alt: image.alt, src: image.src }));
}

export const ocenagorAdapter: GitAdapter = {
  id: 'ocenagor', targets: [target],
  async list(root, targetKey) {
    assertTarget(targetKey);
    const posts = readPosts(await readSource(root, contentPath));
    return posts.map(({ slug, title, description }) => ({ slug, title, description, url: `${target.url}/blog/${slug}` }));
  },
  async prepare(root, targetKey, input, metadata) {
    assertTarget(targetKey);
    const draft = draftSchema.parse(input);
    const fields = metadataSchema.parse(metadata);
    const before = await readSource(root, contentPath);
    const posts = readPosts(before);
    const existing = posts.find(post => post.slug === draft.slug);
    const sections = sectionsFor(draft);
    let article: Record<string, unknown>;
    let additionalChanges: { relativePath: string; before: string; after: string }[] | undefined;
    if (existing) {
      if (fields.imageSourceSlug !== undefined || fields.ctaTemplateSlug !== undefined) throw new Error('Existing articles keep their current cover image and CTA. Image and CTA templates are for new articles only.');
      if (fields.publishedAt && fields.publishedAt < existing.published) throw new Error('The update date cannot be earlier than the original publication date.');
      article = {
        ...existing, title: draft.title, seoTitle: draft.title, description: draft.excerpt, sections,
        ...(fields.category !== undefined ? { category: fields.category } : {}),
        ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
        ...(fields.primaryKeyword !== undefined ? { primaryKeyword: fields.primaryKeyword } : {}),
        ...(fields.takeaway !== undefined ? { takeaway: fields.takeaway } : {}),
        ...(fields.sources !== undefined ? { sources: fields.sources } : {}),
        ...(fields.publishedAt !== undefined ? { updated: fields.publishedAt } : {}),
      };
    } else {
      const required = newMetadataSchema.parse(metadata);
      const template = posts.find(post => post.slug === required.ctaTemplateSlug);
      if (!template) throw new Error('Choose an existing Slovenian article as the CTA template.');
      const imageBefore = await readSource(root, imagesPath);
      const images = readImages(imageBefore);
      const image = Object.hasOwn(images, required.imageSourceSlug) ? images[required.imageSourceSlug] : undefined;
      if (!image) throw new Error('Choose an existing BLOG_IMAGES key as the image source.');
      if (Object.hasOwn(images, draft.slug)) throw new Error('This slug already has an image registry entry. Review that orphaned mapping before creating an article.');
      await validateImageAssets(root, image);
      article = {
        slug: draft.slug, title: draft.title, seoTitle: draft.title, primaryKeyword: required.primaryKeyword,
        description: draft.excerpt, category: required.category, icon: required.icon, published: required.publishedAt,
        takeaway: required.takeaway, sections, sources: required.sources ?? [], cta: template.cta,
      };
      const imageAfter = upsertObjectProperty(imageBefore, 'BLOG_IMAGES', draft.slug, image);
      readImages(imageAfter);
      additionalChanges = [{ relativePath: imagesPath, before: imageBefore, after: imageAfter }];
    }
    articleSchema.parse(article);
    const after = upsertArray(before, 'BLOG_POSTS', [], article);
    readPosts(after);
    return { relativePath: contentPath, before, after, articleUrl: `${target.url}/blog/${draft.slug}`, ...(additionalChanges ? { additionalChanges } : {}) };
  },
};
