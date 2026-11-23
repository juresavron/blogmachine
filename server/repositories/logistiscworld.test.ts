import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logistiscworldAdapter } from './logistiscworld.js';
import { readLiteralExport } from './source.js';

let root: string;
let fixture: string;
const draft = { title: 'Shipping with a clear plan', slug: 'shipping-with-a-clear-plan', excerpt: 'Practical steps for preparing a shipment.', content: '## Prepare the brief\n\nWrite down your shipment details.\n\nAsk for a complete quote.\n\n## Prepare the brief\n\nConfirm who coordinates the handovers.' };
const metadata = { category: 'Planning', artwork: 'checklist', takeaway: 'Compare the same scope before booking.', publishedAt: '2026-11-21', sources: [{ label: 'Official port information', url: 'https://www.luka-kp.si/' }] };
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'blogmachine-logistiscworld-'));
  await mkdir(join(root, 'src/data'), { recursive: true });
  // Repository fixture captured from logistiscworld at dbcfca2c3c94e51e227599ea55d3854ff68a487e.
  fixture = await readFile(new URL('./fixtures/logistics-blog.ts', import.meta.url), 'utf8');
  await writeFile(join(root, 'src/data/blog.ts'), fixture);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

test('lists the actual typed article fixture with its correct canonical website', async () => {
  const articles = await logistiscworldAdapter.list(root, 'main');
  assert.equal(articles.length, 3);
  assert.equal(articles[0]!.slug, 'shipping-through-koper');
  assert.equal(articles[0]!.url, 'https://logisticsworld.eu/blog/shipping-through-koper');
  assert.equal(logistiscworldAdapter.targets[0]!.locale, 'en');
  await assert.rejects(logistiscworldAdapter.list(root, 'mediasped'), /Unknown LogisticsWorld target/);
});

test('prepares structured content without writing files and preserves unrelated articles and code', async () => {
  const result = await logistiscworldAdapter.prepare(root, 'main', draft, metadata);
  assert.equal(result.relativePath, 'src/data/blog.ts');
  assert.equal(result.before, fixture);
  assert.equal(await readFile(join(root, result.relativePath), 'utf8'), fixture);
  assert.equal(result.articleUrl, 'https://logisticsworld.eu/blog/shipping-with-a-clear-plan');
  const original = readLiteralExport(fixture, 'blogPosts') as Record<string, unknown>[];
  const updated = readLiteralExport(result.after, 'blogPosts') as Record<string, unknown>[];
  assert.equal(updated.length, 4);
  assert.deepEqual(updated.slice(1), original);
  assert.equal(updated[0]!.description, draft.excerpt);
  assert.equal(updated[0]!.takeaway, metadata.takeaway);
  assert.deepEqual((updated[0]!.sources as { label: string; url: string }[]).map(({ label, url }) => ({ label, url })), metadata.sources);
  const sections = updated[0]!.sections as { id: string; title: string; paragraphs: string[] }[];
  assert.deepEqual(sections.map(section => section.id), ['prepare-the-brief', 'prepare-the-brief-2']);
  assert.deepEqual(sections[0]!.paragraphs, ['Write down your shipment details.', 'Ask for a complete quote.']);
  assert.ok(result.after.endsWith(fixture.slice(fixture.indexOf('export function getBlogPost'))));
});

test('upserts an existing slug without duplicating it or changing other articles', async () => {
  const replacement = { ...draft, slug: 'shipping-through-koper', title: 'Updated Koper guide' };
  const result = await logistiscworldAdapter.prepare(root, 'main', replacement, metadata);
  const original = readLiteralExport(fixture, 'blogPosts') as Record<string, unknown>[];
  const updated = readLiteralExport(result.after, 'blogPosts') as Record<string, unknown>[];
  assert.equal(updated.length, 3);
  assert.equal(updated.find(article => article.slug === replacement.slug)!.title, replacement.title);
  assert.deepEqual(updated.filter(article => article.slug !== replacement.slug), original.filter(article => article.slug !== replacement.slug));
});

test('updating an article without source metadata preserves its existing citations', async () => {
  const replacement = { ...draft, slug: 'shipping-through-koper' };
  const { sources: _sources, ...withoutSources } = metadata;
  const result = await logistiscworldAdapter.prepare(root, 'main', replacement, withoutSources);
  const original = readLiteralExport(fixture, 'blogPosts') as Record<string, unknown>[];
  const updated = readLiteralExport(result.after, 'blogPosts') as Record<string, unknown>[];
  assert.deepEqual(updated.find(article => article.slug === replacement.slug)!.sources, original.find(article => article.slug === replacement.slug)!.sources);
  const explicitlyCleared = await logistiscworldAdapter.prepare(root, 'main', replacement, { ...withoutSources, sources: [] });
  assert.deepEqual((readLiteralExport(explicitlyCleared.after, 'blogPosts') as Record<string, unknown>[]).find(article => article.slug === replacement.slug)!.sources, []);
});

test('plain text without headings uses the article title and never fabricates sources', async () => {
  const result = await logistiscworldAdapter.prepare(root, 'main', { ...draft, content: 'One paragraph.\n\nAnother paragraph.' }, { category: 'Planning', artwork: 'checklist', takeaway: 'A useful summary.', publishedAt: '2026-02-28' });
  const articles = readLiteralExport(result.after, 'blogPosts') as Record<string, unknown>[];
  const section = (articles[0]!.sections as { title: string; paragraphs: string[] }[])[0]!;
  assert.equal(section.title, draft.title);
  assert.deepEqual(section.paragraphs, ['One paragraph.', 'Another paragraph.']);
  assert.deepEqual(articles[0]!.sources, []);
});

test('required editorial metadata, calendar dates, and HTTPS references are validated', async () => {
  for (const omitted of ['category', 'artwork', 'takeaway', 'publishedAt']) {
    const incomplete: Record<string, unknown> = { ...metadata };
    delete incomplete[omitted];
    await assert.rejects(logistiscworldAdapter.prepare(root, 'main', draft, incomplete));
  }
  for (const invalid of [
    { ...metadata, category: 'General' },
    { ...metadata, artwork: 'photo' },
    { ...metadata, takeaway: ' ' },
    { ...metadata, publishedAt: '2026-02-30' },
    { ...metadata, publishedAt: '2026-2-3' },
    { ...metadata, sources: [{ label: 'Unsafe', url: 'http://example.com' }] },
    { ...metadata, sources: [{ label: 'Unsafe', url: 'https://user:password@example.com' }] },
  ]) await assert.rejects(logistiscworldAdapter.prepare(root, 'main', draft, invalid));
});

test('script-like strings remain inert data while HTML is rejected', async () => {
  const text = 'A literal string: "); globalThis.BLOGMACHINE_INJECTED = true; //';
  const result = await logistiscworldAdapter.prepare(root, 'main', { ...draft, content: text }, metadata);
  const article = (readLiteralExport(result.after, 'blogPosts') as { sections: { paragraphs: string[] }[] }[])[0]!;
  assert.equal(article.sections[0]!.paragraphs[0], text);
  assert.equal('BLOGMACHINE_INJECTED' in globalThis, false);
  await assert.rejects(logistiscworldAdapter.prepare(root, 'main', { ...draft, content: '<script>alert(1)</script>' }, metadata), /plain text/);
});
