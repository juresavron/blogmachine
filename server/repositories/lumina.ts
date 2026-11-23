import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ArticleSummary, ContentDraft, GitAdapter, RepoTarget } from './types.js';
import { parseSections, readLiteralExport, upsertArray } from './source.js';

const contentPath = 'src/data/guides.ts';
const target: RepoTarget = {
  key: 'main',
  label: 'Lumina Pergole',
  url: 'https://pergola-lumina.si',
  locale: 'sl',
  contentPath,
};
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine(value => !value.includes('<'), 'Use plain text without HTML or literal < characters.');
const slugSchema = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers, and single hyphens.');
const guideSchema = z.object({
  slug: slugSchema,
  title: plainText(300),
  description: plainText(1000),
  excerpt: plainText(1000),
  sections: z.array(z.object({ heading: plainText(300), body: plainText(100_000) })).min(1).max(100),
}).strict();
const draftSchema = z.object({ title: plainText(300), slug: slugSchema, excerpt: plainText(1000), content: plainText(100_000) });
const metadataSchema = z.record(z.string(), z.json()).refine(value => !JSON.stringify(value).includes('<'), 'Metadata must not contain HTML or literal < characters.');

function checkTarget(targetKey: string): void {
  if (targetKey !== target.key) throw new Error('Lumina supports only the main content target.');
}
function articleUrl(slug: string): string {
  return `${target.url}/nasveti/${slug}`;
}
function guidesFromSource(source: string) {
  return z.array(guideSchema).parse(readLiteralExport(source, 'guides'));
}

export const luminaAdapter: GitAdapter = {
  id: 'lumina',
  targets: [target],
  async list(root: string, targetKey: string): Promise<ArticleSummary[]> {
    checkTarget(targetKey);
    const source = await readFile(join(root, contentPath), 'utf8');
    return guidesFromSource(source).map(guide => ({ slug: guide.slug, title: guide.title, description: guide.description, url: articleUrl(guide.slug) }));
  },
  async prepare(root: string, targetKey: string, input: ContentDraft, metadata: Record<string, unknown>) {
    checkTarget(targetKey);
    const draft = draftSchema.parse(input);
    metadataSchema.parse(metadata);
    const before = await readFile(join(root, contentPath), 'utf8');
    // Validate the existing collection before proposing an upsert. No content file is written here.
    guidesFromSource(before);
    const article = guideSchema.parse({
      slug: draft.slug,
      title: draft.title,
      description: draft.excerpt,
      excerpt: draft.excerpt,
      sections: parseSections(draft.content).map(section => ({
        heading: section.heading.trim() || draft.title,
        body: section.paragraphs.join('\n\n'),
      })),
    });
    const after = upsertArray(before, 'guides', [], article);
    // Verify that the proposed source still exposes a valid collection to Astro.
    guidesFromSource(after);
    return { relativePath: contentPath, before, after, articleUrl: articleUrl(draft.slug) };
  },
};
