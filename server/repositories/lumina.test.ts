import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { luminaAdapter } from './lumina.js';
import { readLiteralExport } from './source.js';

const originals = [
  { slug: 'bioklimatska-pergola-kaj-je-in-kako-deluje', title: 'Bioklimatska pergola: kaj je in kako deluje', description: 'Prvi obstoječi vodnik.', excerpt: 'Uvod v pergole.', sections: [{ heading: 'Kako deluje', body: 'Prvotna vsebina prvega vodnika.' }] },
  { slug: 'koliko-stane-pergola-vodnik-po-cenah', title: 'Koliko stane pergola? Vodnik po cenah', description: 'Drugi obstoječi vodnik.', excerpt: 'Vodnik po cenah.', sections: [{ heading: 'Cena', body: 'Prvotna vsebina drugega vodnika.' }] },
  { slug: 'aluminijasta-lamelna-pergola-po-meri-od-ideje-do-montaze', title: 'Lamelna pergola po meri: od ideje do montaže', description: 'Tretji obstoječi vodnik.', excerpt: 'Vodnik po montaži.', sections: [{ heading: 'Montaža', body: 'Prvotna vsebina tretjega vodnika.' }] },
];
const fixture = `// Existing introduction must survive.\nexport interface GuideSection { heading: string; body: string; }\nexport interface Guide { slug: string; title: string; description: string; excerpt: string; sections: GuideSection[]; }\nexport const guides: Guide[] = ${JSON.stringify(originals, null, 2)};\n\nexport function getGuide(slug: string): Guide | undefined {\n  return guides.find((guide) => guide.slug === slug);\n}\n// Existing footer must survive.\n`;
const temporaryRoots: string[] = [];
async function createFixture(source = fixture) {
  const root = await mkdtemp(join(tmpdir(), 'blogmachine-lumina-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'src/data'), { recursive: true });
  await writeFile(join(root, 'src/data/guides.ts'), source);
  return root;
}
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const draft = { slug: 'vzdrzevanje-pergole', title: 'Kako vzdrževati pergolo', excerpt: 'Praktični nasveti za vzdrževanje.', content: '## Čiščenje\n\nPrvi odstavek.\n\nDrugi odstavek.\n\n## Pregled\n\nPreverite pritrdilne elemente.' };

test('Lumina lists the three existing guides with their real route shape', async () => {
  const root = await createFixture();
  const articles = await luminaAdapter.list(root, 'main');
  assert.equal(articles.length, 3);
  assert.deepEqual(articles[1], { slug: originals[1].slug, title: originals[1].title, description: originals[1].description, url: `https://pergola-lumina.si/nasveti/${originals[1].slug}` });
  assert.equal(luminaAdapter.targets[0].contentPath, 'src/data/guides.ts');
});

test('Lumina prepares an addition while preserving existing guides and surrounding source without writing', async () => {
  const root = await createFixture();
  const result = await luminaAdapter.prepare(root, 'main', draft, {});
  assert.equal(result.relativePath, 'src/data/guides.ts');
  assert.equal(result.before, fixture);
  assert.equal(result.articleUrl, 'https://pergola-lumina.si/nasveti/vzdrzevanje-pergole');
  assert.equal(await readFile(join(root, result.relativePath), 'utf8'), fixture);
  assert.ok(result.after.startsWith('// Existing introduction must survive.'));
  assert.ok(result.after.endsWith('// Existing footer must survive.\n'));
  assert.ok(result.after.includes('export function getGuide(slug: string): Guide | undefined'));
  const guides = JSON.parse(JSON.stringify(readLiteralExport(result.after, 'guides'))) as typeof originals;
  assert.equal(guides.length, 4);
  for (const original of originals) assert.deepEqual(guides.find(guide => guide.slug === original.slug), original);
  const article = guides.find(guide => guide.slug === draft.slug)!;
  assert.equal(article.description, draft.excerpt);
  assert.equal(article.excerpt, draft.excerpt);
  assert.deepEqual(article.sections, [{ heading: 'Čiščenje', body: 'Prvi odstavek.\n\nDrugi odstavek.' }, { heading: 'Pregled', body: 'Preverite pritrdilne elemente.' }]);
});

test('Lumina upserts an existing slug rather than duplicating it', async () => {
  const root = await createFixture();
  const result = await luminaAdapter.prepare(root, 'main', { ...draft, slug: originals[1].slug, content: 'Spremenjeno besedilo brez podnaslova.' }, {});
  const guides = JSON.parse(JSON.stringify(readLiteralExport(result.after, 'guides'))) as typeof originals;
  assert.equal(guides.length, 3);
  assert.deepEqual(guides.filter(guide => guide.slug !== originals[1].slug), originals.filter(guide => guide.slug !== originals[1].slug));
  assert.equal(guides.find(guide => guide.slug === originals[1].slug)?.title, draft.title);
  assert.deepEqual(guides.find(guide => guide.slug === originals[1].slug)?.sections, [{ heading: draft.title, body: 'Spremenjeno besedilo brez podnaslova.' }]);
});

test('Lumina validates target, slugs, required text, and HTML-sensitive content/metadata', async () => {
  const root = await createFixture();
  await assert.rejects(luminaAdapter.list(root, 'en'), /main content target/);
  await assert.rejects(luminaAdapter.prepare(root, 'en', draft, {}), /main content target/);
  for (const slug of ['../bad', 'Uppercase', 'bad--slug', 'bad/slug', 'bad slug', '']) await assert.rejects(luminaAdapter.prepare(root, 'main', { ...draft, slug }, {}));
  for (const replacement of [{ title: '' }, { excerpt: '' }, { content: '' }, { content: '<script>alert(1)</script>' }, { title: '</script>' }, { excerpt: '<b>Excerpt</b>' }]) await assert.rejects(luminaAdapter.prepare(root, 'main', { ...draft, ...replacement }, {}));
  await assert.rejects(luminaAdapter.prepare(root, 'main', draft, { description: '<script>' }));
  await assert.rejects(luminaAdapter.prepare(root, 'main', draft, { extra: { title: '</script>' } }));
  assert.equal(await readFile(join(root, 'src/data/guides.ts'), 'utf8'), fixture);
});

test('Lumina refuses an incompatible existing collection instead of rewriting it', async () => {
  const root = await createFixture('export const guides = [{ slug: "incomplete" }];\n');
  await assert.rejects(luminaAdapter.list(root, 'main'));
  await assert.rejects(luminaAdapter.prepare(root, 'main', draft, {}));
  assert.equal(await readFile(join(root, 'src/data/guides.ts'), 'utf8'), 'export const guides = [{ slug: "incomplete" }];\n');
});
