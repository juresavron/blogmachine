import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { onlyworldAdapter } from './onlyworld.js';
import { readLiteralExport } from './source.js';

const existing = {
  slug: 'existing-local-guide', title: 'A local guide', description: 'Written for this market.', directoryLink: '/cities', cities: ['wien'],
  sections: [{ heading: 'Local knowledge', paragraphs: ['Keep this editorial content unchanged.'] }],
};
const fixture = `import type { Blog } from './types';\n// Keep the surrounding source and import.\nexport const blog: Blog = ${JSON.stringify({ title: 'Austria guides', description: 'Curated guides for Austria.', posts: [existing] }, null, 2)};\n`;
const draft = { slug: 'vienna-guide', title: 'Vienna, in your own words', excerpt: 'A local introduction to Vienna.', content: '## Getting started\nA first local paragraph.\n\nAnother paragraph.\n\n## A closer look\nLocal details go here.' };

async function fixtureRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'blogmachine-onlyworld-'));
  await mkdir(join(root, 'src/tenants/content/blog'), { recursive: true });
  await writeFile(join(root, 'src/tenants/content/blog/at.ts'), fixture);
  await writeFile(join(root, 'src/tenants/cities.ts'), 'export const CITIES = { at: [{ slug: "wien", name: "Wien" }, { slug: "graz", name: "Graz" }] };');
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('Onlyworld registry maps all 25 country domains without assuming ocenagor is a tenant', () => {
  assert.equal(onlyworldAdapter.targets.length, 25);
  assert.equal(new Set(onlyworldAdapter.targets.map(item => item.key)).size, 25);
  assert.equal(onlyworldAdapter.targets.find(item => item.key === 'at')?.url, 'https://osterreichfans.com');
  assert.equal(onlyworldAdapter.targets.find(item => item.key === 'mx')?.locale, 'es-MX');
  assert.equal(onlyworldAdapter.targets.some(item => item.url.includes('ocenagor')), false);
});

test('lists articles with canonical URLs and prepares structured content without changing target files', async () => {
  await fixtureRoot(async root => {
    const list = await onlyworldAdapter.list(root, 'at');
    assert.deepEqual(list, [{ slug: existing.slug, title: existing.title, description: existing.description, url: 'https://osterreichfans.com/blog/existing-local-guide' }]);
    const result = await onlyworldAdapter.prepare(root, 'at', draft, { directoryLink: '/cities', cities: ['wien', 'graz'] });
    assert.equal(result.relativePath, 'src/tenants/content/blog/at.ts');
    assert.equal(result.before, fixture);
    assert.equal(result.articleUrl, 'https://osterreichfans.com/blog/vienna-guide');
    assert.ok(result.after.includes('// Keep the surrounding source and import.'));
    const blog = readLiteralExport(result.after, 'blog') as { title: string; description: string; posts: Record<string, unknown>[] };
    assert.equal(blog.title, 'Austria guides');
    assert.equal(blog.description, 'Curated guides for Austria.');
    assert.deepEqual(JSON.parse(JSON.stringify(blog.posts.find(item => item.slug === existing.slug))), existing);
    const created = blog.posts.find(item => item.slug === draft.slug)!;
    assert.deepEqual(JSON.parse(JSON.stringify(created.sections)), [{ heading: 'Getting started', paragraphs: ['A first local paragraph.', 'Another paragraph.'] }, { heading: 'A closer look', paragraphs: ['Local details go here.'] }]);
    assert.deepEqual(created.cities, ['wien', 'graz']);
    assert.equal(await readFile(join(root, result.relativePath), 'utf8'), fixture);
  });
});

test('plain-text content uses the article title as its section heading', async () => {
  await fixtureRoot(async root => {
    const result = await onlyworldAdapter.prepare(root, 'at', { ...draft, content: 'A local introduction.\n\nA little more detail.' }, { directoryLink: '/cities' });
    const blog = readLiteralExport(result.after, 'blog') as { posts: Record<string, unknown>[] };
    assert.deepEqual(JSON.parse(JSON.stringify(blog.posts.find(item => item.slug === draft.slug)?.sections)), [{ heading: draft.title, paragraphs: ['A local introduction.', 'A little more detail.'] }]);
  });
});

test('updates by slug idempotently, retaining city metadata and other articles', async () => {
  await fixtureRoot(async root => {
    const update = { ...draft, slug: existing.slug, title: 'An updated local guide' };
    const first = await onlyworldAdapter.prepare(root, 'at', update, { directoryLink: '/cities' });
    const blog = readLiteralExport(first.after, 'blog') as { posts: Record<string, unknown>[] };
    assert.equal(blog.posts.length, 1);
    assert.equal(blog.posts[0].title, update.title);
    assert.deepEqual(blog.posts[0].cities, ['wien']);
    await writeFile(join(root, first.relativePath), first.after);
    const second = await onlyworldAdapter.prepare(root, 'at', update, { directoryLink: '/cities' });
    assert.equal(second.after, first.after);
  });
});

test('requires explicit directory metadata and a real description, rejects unknown city links', async () => {
  await fixtureRoot(async root => {
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', draft, {}));
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', { ...draft, excerpt: '   ' }, { directoryLink: '/cities' }));
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', draft, { directoryLink: '/unknown' }));
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', draft, { directoryLink: '/cities', cities: ['berlin'] }), /city registry/);
    const cleared = await onlyworldAdapter.prepare(root, 'at', { ...draft, slug: existing.slug }, { directoryLink: '/creators', cities: [] });
    const blog = readLiteralExport(cleared.after, 'blog') as { posts: Record<string, unknown>[] };
    assert.deepEqual(blog.posts[0].cities, []);
  });
});

test('rejects path traversal targets and content symlinks that leave the repository', async () => {
  await fixtureRoot(async root => {
    for (const key of ['../../outside', '__proto__', 'constructor', 'si']) {
      await assert.rejects(onlyworldAdapter.list(root, key), /Unknown Onlyworld market/);
      await assert.rejects(onlyworldAdapter.prepare(root, key, draft, { directoryLink: '/cities' }), /Unknown Onlyworld market/);
    }
    const outside = await mkdtemp(join(tmpdir(), 'blogmachine-outside-'));
    try {
      await writeFile(join(outside, 'article.ts'), fixture);
      await rm(join(root, 'src/tenants/content/blog/at.ts'));
      await symlink(join(outside, 'article.ts'), join(root, 'src/tenants/content/blog/at.ts'));
      await assert.rejects(onlyworldAdapter.list(root, 'at'), /inside the selected repository/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test('literal escaping preserves quotes and backslashes without evaluating source; HTML is rejected', async () => {
  await fixtureRoot(async root => {
    const literal = 'A "quoted" title with \\ paths and ${notExecuted}';
    const result = await onlyworldAdapter.prepare(root, 'at', { ...draft, title: literal, content: '## A `heading`\nA "quote", a backslash \\, and ${notExecuted} stay literal.' }, { directoryLink: '/best' });
    const blog = readLiteralExport(result.after, 'blog') as { posts: Record<string, unknown>[] };
    assert.equal(blog.posts.find(item => item.slug === draft.slug)?.title, literal);
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', { ...draft, title: '</script><script>alert(1)</script>' }, { directoryLink: '/best' }), /plain text/);
    await assert.rejects(onlyworldAdapter.prepare(root, 'at', { ...draft, content: '## Heading\n<p>Raw HTML</p>' }, { directoryLink: '/best' }), /plain text/);
    await writeFile(join(root, 'src/tenants/content/blog/at.ts'), 'export const blog = (() => { throw new Error("evaluated"); })();');
    await assert.rejects(onlyworldAdapter.list(root, 'at'));
  });
});
