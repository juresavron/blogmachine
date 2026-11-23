import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { getOcenagorImageChoices, ocenagorAdapter } from './ocenagor.js';
import { readLiteralExport, readLiteralVariable } from './source.js';

const primary = 'src/content/blog/sl.ts';
const imagesPath = 'src/content/blog/images.ts';
const basePost = {
  slug: 'existing-guide', title: 'Existing guide', seoTitle: 'Existing SEO title', primaryKeyword: 'lokalni vodič', description: 'Existing description',
  category: 'NFC komponente', icon: 'nfc', published: '2026-11-10', takeaway: 'A checked takeaway.', imageAlt: 'Existing bespoke alt',
  sections: [{ id: 'existing-section', title: 'A section', paragraphs: ['Existing paragraphs.'], bullets: ['A useful detail.'] }],
  sources: [{ label: 'Original checked source', href: 'https://developers.google.com/search/docs' }],
  cta: { title: 'Existing CTA', text: 'Contact us about this service.', label: 'Contact', href: '/kontakt?service=nfc' },
  leadOffer: { variant: 'acrylic', label: 'Product', items: 'Included items', yearly: 'Annual', monthly: 'Monthly' },
};
const image = { src: '/images/blog/existing.webp', small: '/images/blog/existing-640.webp', share: '/images/blog/existing-share.jpg', alt: 'Approved existing image', author: 'Original photographer', source: 'https://unsplash.com/photos/existing', license: 'https://unsplash.com/license' };
const blogSource = `import type { VariantId } from '../../config/store';\n// Preserve this source wrapper.\nexport const BLOG_POSTS: BlogPost[] = ${JSON.stringify([basePost], null, 2)};\nexport const unrelated = 'unchanged';\n`;
const imageSource = `import { activeTenant } from '../../tenants';\n// Preserve image attribution and venue maps.\nconst BLOG_IMAGES: Record<string, BlogImage> = ${JSON.stringify({ 'existing-guide': image }, null, 2)};\nconst VENUE_IMAGES = { venue: { src: '/images/blog/venue.webp' } };\nexport function blogImageFor(post: BlogPost) { return BLOG_IMAGES[post.slug]; }\n`;
const draft = { slug: 'a-new-local-guide', title: 'A new local guide', excerpt: 'An explicit editorial description.', content: '## Getting started\nA local paragraph.\n\n## Getting started\nA second local paragraph.\n\n## Getting started-2\nA third detail.' };
const metadata = { category: 'NFC komponente', icon: 'nfc', publishedAt: '2026-11-21', primaryKeyword: 'nov lokalni vodič', takeaway: 'An explicit useful takeaway.', ctaTemplateSlug: basePost.slug, imageSourceSlug: basePost.slug };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

async function fixtureRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'blogmachine-ocenagor-'));
  await mkdir(join(root, dirname(primary)), { recursive: true });
  await mkdir(join(root, 'public/images/blog'), { recursive: true });
  await writeFile(join(root, primary), blogSource);
  await writeFile(join(root, imagesPath), imageSource);
  for (const asset of [image.src, image.small, image.share]) await writeFile(join(root, `public${asset}`), 'fixture image bytes');
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('Ocenagor lists SI posts and image choices from literal source only', async () => {
  await fixtureRoot(async root => {
    assert.equal(ocenagorAdapter.id, 'ocenagor');
    assert.deepEqual(ocenagorAdapter.targets[0].additionalPaths, [imagesPath]);
    assert.deepEqual(await ocenagorAdapter.list(root, 'si'), [{ slug: basePost.slug, title: basePost.title, description: basePost.description, url: 'https://ocenagor.si/blog/existing-guide' }]);
    assert.deepEqual(await getOcenagorImageChoices(root), [{ slug: basePost.slug, alt: image.alt, src: image.src }]);
    await assert.rejects(ocenagorAdapter.list(root, 'hr'), /Slovenian content only/);
    await assert.rejects(ocenagorAdapter.list(root, '../../outside'), /Slovenian content only/);
  });
});

test('new article prepares two files, copies only explicitly selected CTA/image and preserves asset paths and attribution', async () => {
  await fixtureRoot(async root => {
    const change = await ocenagorAdapter.prepare(root, 'si', draft, metadata);
    assert.equal(change.relativePath, primary);
    assert.equal(change.articleUrl, 'https://ocenagor.si/blog/a-new-local-guide');
    assert.equal(change.before, blogSource);
    assert.equal(change.additionalChanges?.length, 1);
    const imageChange = change.additionalChanges![0];
    assert.equal(imageChange.relativePath, imagesPath);
    assert.equal(imageChange.before, imageSource);
    const posts = plain(readLiteralExport(change.after, 'BLOG_POSTS'));
    assert.equal(posts.length, 2);
    assert.deepEqual(posts.find((post: { slug: string }) => post.slug === basePost.slug), basePost);
    const created = posts.find((post: { slug: string }) => post.slug === draft.slug);
    assert.deepEqual(created.cta, basePost.cta);
    assert.deepEqual(created.sources, []);
    assert.equal(created.leadOffer, undefined);
    assert.equal(created.primaryKeyword, metadata.primaryKeyword);
    assert.equal(created.published, metadata.publishedAt);
    assert.equal(new Set(created.sections.map((section: { id: string }) => section.id)).size, 3);
    const mapping = plain(readLiteralVariable(imageChange.after, 'BLOG_IMAGES'));
    assert.deepEqual(mapping[draft.slug], image);
    assert.deepEqual(mapping[basePost.slug], image);
    assert.ok(imageChange.after.includes("const VENUE_IMAGES = { venue: { src: '/images/blog/venue.webp' } };"));
    assert.ok(imageChange.after.includes('export function blogImageFor'));
    assert.equal(await readFile(join(root, primary), 'utf8'), blogSource);
    assert.equal(await readFile(join(root, imagesPath), 'utf8'), imageSource);
  });
});

test('existing updates retain rich metadata and image mappings; explicit date becomes updated, not published', async () => {
  await fixtureRoot(async root => {
    const change = await ocenagorAdapter.prepare(root, 'si', { ...draft, slug: basePost.slug }, { publishedAt: '2026-11-21' });
    const posts = plain(readLiteralExport(change.after, 'BLOG_POSTS'));
    const updated = posts[0];
    assert.equal(posts.length, 1);
    assert.equal(updated.title, draft.title);
    assert.equal(updated.seoTitle, draft.title);
    assert.equal(updated.description, draft.excerpt);
    for (const key of ['category', 'icon', 'published', 'imageAlt', 'takeaway', 'primaryKeyword', 'cta', 'sources', 'leadOffer']) assert.deepEqual(updated[key], basePost[key as keyof typeof basePost]);
    assert.equal(updated.updated, '2026-11-21');
    assert.equal(change.additionalChanges, undefined);
    assert.equal(await readFile(join(root, imagesPath), 'utf8'), imageSource);
    const removedSources = await ocenagorAdapter.prepare(root, 'si', { ...draft, slug: basePost.slug }, { sources: [] });
    assert.deepEqual(plain(readLiteralExport(removedSources.after, 'BLOG_POSTS'))[0].sources, []);
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', { ...draft, slug: basePost.slug }, { publishedAt: '2026-11-01' }), /earlier than/);
  });
});

test('new articles require complete metadata and existing CTA/image sources; invalid fields fail before any writes', async () => {
  await fixtureRoot(async root => {
    for (const key of Object.keys(metadata)) {
      const incomplete = { ...metadata } as Record<string, unknown>;
      delete incomplete[key];
      await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, incomplete));
    }
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, { ...metadata, publishedAt: '2026-02-30' }), /real YYYY-MM-DD/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, { ...metadata, ctaTemplateSlug: 'not-real' }), /CTA template/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, { ...metadata, imageSourceSlug: 'not-real' }), /BLOG_IMAGES key/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, { ...metadata, sources: [{ label: 'Unsafe', href: 'javascript:alert(1)' }] }));
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', { ...draft, excerpt: '' }, metadata));
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', { ...draft, content: '<script>unsafe</script>' }, metadata), /plain text/);
    assert.equal(await readFile(join(root, primary), 'utf8'), blogSource);
    assert.equal(await readFile(join(root, imagesPath), 'utf8'), imageSource);
  });
});

test('selected image assets must exist and cannot escape the repository through symlinks', async () => {
  await fixtureRoot(async root => {
    await rm(join(root, `public${image.src}`));
    await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, metadata), /ENOENT/);
    const outside = await mkdtemp(join(tmpdir(), 'blogmachine-ocenagor-outside-'));
    try {
      await writeFile(join(outside, 'outside.webp'), 'not in this repository');
      await symlink(join(outside, 'outside.webp'), join(root, `public${image.src}`));
      await assert.rejects(ocenagorAdapter.prepare(root, 'si', draft, metadata), /inside the selected repository/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test('plain content gets a title section and quoted text stays literal without executing source', async () => {
  await fixtureRoot(async root => {
    const input = { ...draft, title: 'A "quoted" title with ${literal}', content: 'Plain content with a backslash \\ and ${literal}.' };
    const change = await ocenagorAdapter.prepare(root, 'si', input, metadata);
    const created = plain(readLiteralExport(change.after, 'BLOG_POSTS')).find((post: { slug: string }) => post.slug === draft.slug);
    assert.equal(created.sections[0].title, input.title);
    assert.equal(created.sections[0].paragraphs[0], input.content);
    await writeFile(join(root, primary), 'export const BLOG_POSTS = (() => { throw new Error("executed"); })();');
    await assert.rejects(ocenagorAdapter.list(root, 'si'), /no code was evaluated|computed content/);
  });
});
