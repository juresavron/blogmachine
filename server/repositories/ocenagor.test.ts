import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { getOcenagorImageChoices, ocenagorAdapter } from './ocenagor.js';
import { readLiteralExport, readLiteralVariable, upsertArray, upsertObjectProperty } from './source.js';

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
const localizationSource = `import type { BlogPost, BlogSection } from './sl';
const coreArticleKeys = { overview: 'existing-guide' } as const;
const productArticleKeys = {} as const;
export const bookingArticleKeys = {} as const;
export const articleKeys = { ...coreArticleKeys, ...productArticleKeys, ...bookingArticleKeys };
export type ArticleKey = keyof typeof articleKeys;
export type ProductArticleKey = keyof typeof productArticleKeys;
export interface LocalizedPost { slug: string; title: string; seoTitle: string; keyword: string; description: string; takeaway: string; imageAlt: string; sections: BlogSection[]; cta?: BlogPost['cta']; }
export interface BlogTranslation { articles: Record<keyof typeof coreArticleKeys, LocalizedPost> & Partial<Record<ProductArticleKey | keyof typeof bookingArticleKeys, LocalizedPost>>; }
export function section(id: string, title: string, paragraphs: string | string[], details = {}) {
  return { id, title, paragraphs: typeof paragraphs === 'string' ? [paragraphs] : paragraphs, ...details };
}
`;
const localized = {
  hr: { slug: 'postojeci-vodic', title: 'Postojeći vodič', seoTitle: 'Postojeći SEO naslov', keyword: 'postojeći vodič', description: 'Opis postojećeg vodiča.', takeaway: 'Provjerena poruka za hrvatske čitatelje.', imageAlt: 'Odobrena fotografija lokala', published: '2026-11-12', updated: '2026-11-14',
    cta: { title: 'Kontaktirajte nas', text: 'Odaberite rješenje za svoj lokal.', label: 'Pogledajte ponudu', href: '/google-ocjene' },
    sources: [{ label: 'Provjereni izvor', href: 'https://ocjenagor.hr/google-ocjene' }], leadOffer: { variant: 'acrylic', label: 'Proizvod', items: 'Komponente', yearly: 'godišnje', monthly: 'mjesečno' },
    sections: [{ id: 'pocetak', title: 'Početak', paragraphs: ['Izvorni odlomak.'], related: ['overview'], bullets: ['Sačuvajte korisne podatke.'] }],
  },
  it: { slug: 'guida-esistente', title: 'Guida esistente', seoTitle: 'Titolo SEO esistente', keyword: 'guida esistente', description: 'Descrizione della guida.', takeaway: 'Un consiglio utile per i lettori italiani.', imageAlt: 'Foto approvata del locale',
    cta: { title: 'Contattaci', text: 'Scegli una soluzione per il tuo locale.', label: 'Scopri le targhette', href: '/recensioni-google' },
    sections: [{ id: 'inizio', title: 'Inizio', paragraphs: ['Un paragrafo originale.'] }],
  },
};
function languageSource(locale: 'hr' | 'it', article: Record<string, unknown> = localized[locale]): string {
  const property = JSON.stringify({ ...article, sections: undefined }, null, 2).replace(/\n}/, ",\nsections: [section('intro', 'Localized introduction', ['A localized paragraph.'], { related: ['overview'] })]\n}");
  return `import { section, type BlogTranslation } from './localization';
import { ${locale}Products } from './${locale}-products';
import { ${locale}BookingGuides } from './${locale}-booking';
export const ${locale}: BlogTranslation = {
  copy: { nextTitle: '${locale === 'hr' ? 'Sljedeći korak' : 'Il prossimo passo'}', nextText: '${locale === 'hr' ? 'Odaberite pločice za svoj lokal.' : 'Scegli le targhette per il tuo locale.'}', componentsAction: '${locale === 'hr' ? 'Pogledajte pločice' : 'Scopri le targhette'}' },
  categories: { 'NFC komponente': '${locale === 'hr' ? 'NFC pločice' : 'Targhette NFC'}' },
  articles: { ...${locale}Products, ...${locale}BookingGuides, overview: ${property} },
  sourceLabels: {},
};
export const unrelated = 'keep this wrapper';
`;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

async function fixtureRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'blogmachine-ocenagor-'));
  await mkdir(join(root, dirname(primary)), { recursive: true });
  await mkdir(join(root, 'public/images/blog'), { recursive: true });
  await writeFile(join(root, primary), blogSource);
  await writeFile(join(root, imagesPath), imageSource);
  await writeFile(join(root, 'src/content/blog/localization.ts'), localizationSource);
  for (const locale of ['hr', 'it'] as const) {
    await writeFile(join(root, `src/content/blog/${locale}.ts`), languageSource(locale));
    await writeFile(join(root, `src/content/blog/${locale}-products.ts`), `export const ${locale}Products = {} as const;`);
    await writeFile(join(root, `src/content/blog/${locale}-booking.ts`), `export const ${locale}BookingGuides = {} as const;`);
  }
  await writeFile(join(root, 'src/content/blog/index.ts'), '// Runtime source registry fixture.');
  for (const asset of [image.src, image.small, image.share]) await writeFile(join(root, `public${asset}`), 'fixture image bytes');
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('Ocenagor lists SI posts and image choices from literal source only', async () => {
  await fixtureRoot(async root => {
    assert.equal(ocenagorAdapter.id, 'ocenagor');
    assert(ocenagorAdapter.targets[0].additionalPaths?.includes(imagesPath));
    assert(ocenagorAdapter.targets[0].additionalPaths?.includes('src/content/blog/localization.ts'));
    assert.deepEqual(ocenagorAdapter.targets.map(target => target.key), ['si', 'hr', 'it']);
    const articles = await ocenagorAdapter.list(root, 'si');
    assert.deepEqual(articles.map(({ slug, title, description, url }) => ({ slug, title, description, url })), [{ slug: basePost.slug, title: basePost.title, description: basePost.description, url: 'https://ocenagor.si/blog/existing-guide' }]);
    assert.deepEqual(await getOcenagorImageChoices(root), [{ slug: basePost.slug, alt: image.alt, src: image.src }]);
    assert.equal((await ocenagorAdapter.list(root, 'hr'))[0].slug, localized.hr.slug);
    await assert.rejects(ocenagorAdapter.list(root, '../../outside'), /supported OcenaGor/);
  });
});

test('new article prepares source, image, and optional translation registry files, copies only explicitly selected CTA/image and preserves asset paths and attribution', async () => {
  await fixtureRoot(async root => {
    const change = await ocenagorAdapter.prepare(root, 'si', draft, metadata);
    assert.equal(change.relativePath, primary);
    assert.equal(change.articleUrl, 'https://ocenagor.si/blog/a-new-local-guide');
    assert.equal(change.before, blogSource);
    assert.equal(change.additionalChanges?.length, 2);
    assert.equal(change.additionalChanges![1].relativePath, 'src/content/blog/localization.ts');
    assert.match(change.additionalChanges![1].after, /editorialArticleKeys/);
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


function literalProperty(source: string, key: string): Record<string, any> {
  const file = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let expression: ts.Expression | undefined;
  function find(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === key) expression = node.initializer;
    ts.forEachChild(node, find);
  }
  find(file);
  assert(expression, `Missing literal property ${key}`);
  return plain(readLiteralExport('export const value = ' + expression.getText(file), 'value'));
}
async function applyFixtureChange(root: string, change: Awaited<ReturnType<typeof ocenagorAdapter.prepare>>) {
  for (const part of [change, ...(change.additionalChanges ?? [])]) {
    assert.equal(await readFile(join(root, part.relativePath), 'utf8'), part.before);
    await writeFile(join(root, part.relativePath), part.after);
  }
}
async function addUntranslatedSource(root: string, slug = 'untranslated-source') {
  const post = { ...basePost, slug, title: 'Izvirni slovenski članek', seoTitle: 'Slovenski SEO naslov' };
  await writeFile(join(root, primary), upsertArray(await readFile(join(root, primary), 'utf8'), 'BLOG_POSTS', [], post));
  await writeFile(join(root, imagesPath), upsertObjectProperty(await readFile(join(root, imagesPath), 'utf8'), 'BLOG_IMAGES', slug, image));
  return post;
}
const localizedMetadata = (locale: 'hr' | 'it', sourceSlug = 'untranslated-source') => ({
  sourceSlug, seoTitle: locale === 'hr' ? 'Novi lokalni vodič za poduzeća' : 'Nuova guida locale per attività',
  primaryKeyword: locale === 'hr' ? 'lokalni vodič' : 'guida locale', takeaway: locale === 'hr' ? 'Jasna poruka za hrvatske čitatelje.' : 'Un consiglio chiaro per i lettori italiani.',
  imageAlt: locale === 'hr' ? 'Fotografija restorana u Hrvatskoj' : 'Foto di un ristorante in Italia', publishedAt: '2026-11-21', ctaTemplateSlug: localized[locale].slug,
});
const localizedDraft = (locale: 'hr' | 'it') => ({
  slug: locale === 'hr' ? 'novi-lokalni-vodic' : 'nuova-guida-locale', title: locale === 'hr' ? 'Novi lokalni vodič' : 'Nuova guida locale',
  excerpt: locale === 'hr' ? 'Opis namijenjen hrvatskim čitateljima.' : 'Una descrizione per i lettori italiani.',
  content: locale === 'hr' ? '## Prvi korak\nIzvorno pripremljen hrvatski tekst.' : '## Primo passo\nUn testo italiano preparato manualmente.',
});

test('family lists retain canonical pairing while exposing language-specific SEO and URLs', async () => {
  await fixtureRoot(async root => {
    const si = (await ocenagorAdapter.list(root, 'si'))[0];
    assert.equal(si.sourceSlug, basePost.slug);
    assert.deepEqual(si.versions?.map(version => [version.targetKey, version.locale, version.slug]), [['si', 'sl', basePost.slug], ['hr', 'hr', localized.hr.slug], ['it', 'it', localized.it.slug]]);
    for (const locale of ['hr', 'it'] as const) {
      const article = (await ocenagorAdapter.list(root, locale))[0];
      assert.equal(article.sourceSlug, basePost.slug);
      assert.equal(article.articleKey, 'overview');
      assert.equal(article.primaryKeyword, localized[locale].keyword);
      assert.equal(article.seoTitle, localized[locale].seoTitle);
      assert.equal(article.url, `${locale === 'hr' ? 'https://ocjenagor.hr' : 'https://valutosu.it'}/blog/${localized[locale].slug}`);
      assert.equal(article.versions?.length, 3);
    }
  });
});

test('new HR and IT counterparts use manual localized text and same-language CTA, registering optional editorial pairing', async () => {
  for (const locale of ['hr', 'it'] as const) await fixtureRoot(async root => {
    await addUntranslatedSource(root);
    const beforeSI = await readFile(join(root, primary), 'utf8');
    const other = locale === 'hr' ? 'it' : 'hr';
    const beforeOther = await readFile(join(root, `src/content/blog/${other}.ts`), 'utf8');
    const change = await ocenagorAdapter.prepare(root, locale, localizedDraft(locale), localizedMetadata(locale));
    assert.equal(change.relativePath, `src/content/blog/${locale}.ts`);
    assert.deepEqual(change.additionalChanges?.map(part => part.relativePath), ['src/content/blog/localization.ts']);
    const article = literalProperty(change.after, 'editorial_untranslated_source');
    assert.equal(article.slug, localizedDraft(locale).slug);
    assert.equal(article.title, localizedDraft(locale).title);
    assert.equal(article.seoTitle, localizedMetadata(locale).seoTitle);
    assert.equal(article.keyword, localizedMetadata(locale).primaryKeyword);
    assert.equal(article.imageAlt, localizedMetadata(locale).imageAlt);
    assert.deepEqual(article.sources, []);
    assert.deepEqual(article.cta, localized[locale].cta);
    assert.notDeepEqual(article.cta, basePost.cta);
    assert.equal(article.sections[0].paragraphs[0], localizedDraft(locale).content.split('\n')[1]);
    assert.equal(article.leadOffer, undefined);
    const registry = change.additionalChanges![0].after;
    assert.match(registry, /const editorialArticleKeys/);
    assert.match(registry, /\.\.\.editorialArticleKeys/);
    assert.match(registry, /Partial<Record<ProductArticleKey \| keyof typeof bookingArticleKeys \| keyof typeof editorialArticleKeys, LocalizedPost>>/);
    assert.equal(await readFile(join(root, primary), 'utf8'), beforeSI);
    assert.equal(await readFile(join(root, `src/content/blog/${other}.ts`), 'utf8'), beforeOther);
    await applyFixtureChange(root, change);
    const linked = (await ocenagorAdapter.list(root, locale)).find(post => post.slug === localizedDraft(locale).slug)!;
    assert.equal(linked.sourceSlug, 'untranslated-source');
    assert.deepEqual(linked.versions?.map(version => version.targetKey), ['si', locale]);
  });
});

test('new Slovenian articles can acquire both language versions without changing their canonical source or duplicating registry keys', async () => {
  await fixtureRoot(async root => {
    const siChange = await ocenagorAdapter.prepare(root, 'si', draft, { ...metadata, seoTitle: 'Ločen slovenski SEO naslov' });
    await applyFixtureChange(root, siChange);
    const registry = await readFile(join(root, 'src/content/blog/localization.ts'), 'utf8');
    for (const locale of ['hr', 'it'] as const) {
      const change = await ocenagorAdapter.prepare(root, locale, localizedDraft(locale), localizedMetadata(locale, draft.slug));
      assert.equal(change.additionalChanges, undefined, 'the canonical key already exists');
      await applyFixtureChange(root, change);
    }
    assert.equal(await readFile(join(root, 'src/content/blog/localization.ts'), 'utf8'), registry);
    const article = (await ocenagorAdapter.list(root, 'si')).find(post => post.slug === draft.slug)!;
    assert.equal(article.seoTitle, 'Ločen slovenski SEO naslov');
    assert.deepEqual(article.versions?.map(version => version.targetKey), ['si', 'hr', 'it']);
  });
});

test('existing localized edits preserve publication, SEO, CTA, sources, and offers unless explicitly overridden', async () => {
  await fixtureRoot(async root => {
    const input = { ...localizedDraft('hr'), slug: localized.hr.slug };
    const change = await ocenagorAdapter.prepare(root, 'hr', input, { sourceSlug: basePost.slug, publishedAt: '2026-11-22' });
    const article = literalProperty(change.after, 'overview');
    assert.equal(article.title, input.title);
    assert.equal(article.description, input.excerpt);
    for (const key of ['seoTitle', 'keyword', 'takeaway', 'imageAlt', 'published', 'cta', 'sources', 'leadOffer'] as const) assert.deepEqual(article[key], localized.hr[key]);
    assert.equal(article.updated, '2026-11-22');
    assert.equal(change.additionalChanges, undefined);
    assert(change.after.includes("export const unrelated = 'keep this wrapper';"));
    const explicit = await ocenagorAdapter.prepare(root, 'hr', input, { seoTitle: 'Novi SEO naslov', primaryKeyword: 'nova ključna riječ', imageAlt: 'Novi opis fotografije', sources: [] });
    assert.equal(literalProperty(explicit.after, 'overview').seoTitle, 'Novi SEO naslov');
    assert.deepEqual(literalProperty(explicit.after, 'overview').sources, []);
    await assert.rejects(ocenagorAdapter.prepare(root, 'hr', input, { sourceSlug: 'another-source' }), /paired with a different/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'hr', input, { publishedAt: '2026-11-01' }), /earlier than/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'hr', input, { ctaTemplateSlug: localized.hr.slug }), /keep their current CTA/);
  });
});

test('localized product and booking edits target the owning split data file, preserving imports and other language records', async () => {
  for (const group of ['products', 'booking'] as const) await fixtureRoot(async root => {
    const source = await addUntranslatedSource(root, `source-${group}`);
    const variable = group === 'products' ? 'productArticleKeys' : 'bookingArticleKeys';
    const registry = localizationSource.replace(`const ${variable} = {}`, `const ${variable} = { guide: '${source.slug}' }`);
    await writeFile(join(root, 'src/content/blog/localization.ts'), registry);
    const file = `src/content/blog/hr-${group}.ts`;
    const exported = group === 'products' ? 'hrProducts' : 'hrBookingGuides';
    await writeFile(join(root, file), `import { section } from './localization';\nexport const ${exported} = { guide: ${JSON.stringify({ ...localized.hr, slug: `vodic-${group}` }, null, 2)} } as const;\nexport const unrelated = 'retained';`);
    const originalRoot = await readFile(join(root, 'src/content/blog/hr.ts'), 'utf8');
    const change = await ocenagorAdapter.prepare(root, 'hr', { ...localizedDraft('hr'), slug: `vodic-${group}` }, { sourceSlug: source.slug });
    assert.equal(change.relativePath, file);
    assert.equal(change.additionalChanges, undefined);
    assert.equal(literalProperty(change.after, 'guide').title, localizedDraft('hr').title);
    assert(change.after.includes("export const unrelated = 'retained';"));
    assert.equal(await readFile(join(root, 'src/content/blog/hr.ts'), 'utf8'), originalRoot);
  });
});

test('localized creation rejects wrong pairings, missing fields, foreign templates, changed slugs, and absent cover assets', async () => {
  await fixtureRoot(async root => {
    await addUntranslatedSource(root);
    const fields = localizedMetadata('it');
    for (const key of ['sourceSlug', 'seoTitle', 'primaryKeyword', 'takeaway', 'imageAlt', 'ctaTemplateSlug']) {
      const incomplete: Record<string, unknown> = { ...fields }; delete incomplete[key];
      await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), incomplete));
    }
    await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), { ...fields, ctaTemplateSlug: localized.hr.slug }), /destination language/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), { ...fields, sourceSlug: 'missing-source' }), /existing Slovenian source/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), { ...fields, sourceSlug: basePost.slug }), /already has a version/);
    await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), { ...fields, category: 'NFC komponente' }));
    await rm(join(root, `public${image.src}`));
    await assert.rejects(ocenagorAdapter.prepare(root, 'it', localizedDraft('it'), fields), /ENOENT/);
  });
});

test('core CTA fallback uses localized global copy and localized route instead of Slovenian CTA text', async () => {
  for (const locale of ['hr', 'it'] as const) await fixtureRoot(async root => {
    await addUntranslatedSource(root);
    await writeFile(join(root, primary), blogSource.replace('/kontakt?service=nfc', '/google-ocene'));
    await addUntranslatedSource(root);
    await writeFile(join(root, `src/content/blog/${locale}.ts`), languageSource(locale, { ...localized[locale], cta: undefined }));
    const change = await ocenagorAdapter.prepare(root, locale, localizedDraft(locale), localizedMetadata(locale));
    const article = literalProperty(change.after, 'editorial_untranslated_source');
    assert.equal(article.cta.href, locale === 'hr' ? '/google-ocjene' : '/recensioni-google');
    assert.equal(article.cta.title, locale === 'hr' ? 'Sljedeći korak' : 'Il prossimo passo');
    assert.notEqual(article.cta.text, basePost.cta.text);
  });
});

test('localized loader rejects computed values, changed helper semantics, duplicates, and escaping content symlinks without evaluation', async () => {
  await fixtureRoot(async root => {
    const file = join(root, 'src/content/blog/hr.ts');
    await writeFile(file, languageSource('hr').replace("['A localized paragraph.']", "(() => { throw new Error('must not run'); })()"));
    await assert.rejects(ocenagorAdapter.list(root, 'hr'), /no code was evaluated/);
    await writeFile(file, languageSource('hr'));
    await writeFile(join(root, 'src/content/blog/localization.ts'), localizationSource.replace('...details };', '...details, title: id };'));
    await assert.rejects(ocenagorAdapter.list(root, 'hr'), /section helper changed/);
    await writeFile(join(root, 'src/content/blog/localization.ts'), localizationSource);
    await writeFile(file, languageSource('hr').replace('overview: {', 'overview: { slug: \"duplicate\",'));
    await assert.rejects(ocenagorAdapter.list(root, 'hr'), /Duplicate content properties/);
    await rm(file);
    const outside = await mkdtemp(join(tmpdir(), 'blogmachine-localized-outside-'));
    try {
      await writeFile(join(outside, 'hr.ts'), languageSource('hr'));
      await symlink(join(outside, 'hr.ts'), file);
      await assert.rejects(ocenagorAdapter.list(root, 'hr'), /inside the selected repository/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});


test('unmapped SI articles with venue-only covers can acquire HR and IT counterparts without changing cover registries', async () => {
  for (const locale of ['hr', 'it'] as const) await fixtureRoot(async root => {
    const source = await addUntranslatedSource(root);
    const cover = { src: '/images/blog/venue-cover.webp', small: '/images/blog/venue-cover-640.webp', share: '/images/blog/venue-cover-share.jpg', venue: 'Approved venue', alt: { sl: 'Fotografija lokala', hr: 'Fotografija hrvatskog lokala', it: 'Foto del locale italiano' } };
    // Mirror the four actual SI-only articles: approved venue mapping, without a
    // direct BLOG_IMAGES entry for the canonical source slug.
    const before = imageSource.replace("const VENUE_IMAGES = { venue: { src: '/images/blog/venue.webp' } };", `const VENUE_IMAGES = ${JSON.stringify({ 'approved-venue-source': cover })};\nconst VENUE_COVER_SOURCE = ${JSON.stringify({ [source.slug]: 'approved-venue-source' })};`);
    await writeFile(join(root, imagesPath), before);
    for (const asset of [cover.src, cover.small, cover.share]) await writeFile(join(root, `public${asset}`), 'approved venue image bytes');
    const change = await ocenagorAdapter.prepare(root, locale, localizedDraft(locale), localizedMetadata(locale));
    assert.equal(change.relativePath, `src/content/blog/${locale}.ts`);
    assert.deepEqual(change.additionalChanges?.map(part => part.relativePath), ['src/content/blog/localization.ts']);
    assert.equal(await readFile(join(root, imagesPath), 'utf8'), before);
    await applyFixtureChange(root, change);
    assert.equal((await ocenagorAdapter.list(root, locale)).find(article => article.slug === localizedDraft(locale).slug)?.sourceSlug, source.slug);
    await rm(join(root, `public${cover.small}`));
    // Another unregistered source using that same venue must still validate all
    // effective files rather than accepting a registry entry alone.
    await addUntranslatedSource(root, 'another-venue-source');
    await writeFile(join(root, imagesPath), before.replace(`"${source.slug}":"approved-venue-source"`, `"${source.slug}":"approved-venue-source","another-venue-source":"approved-venue-source"`));
    await assert.rejects(ocenagorAdapter.prepare(root, locale, { ...localizedDraft(locale), slug: 'another-localized-guide' }, { ...localizedMetadata(locale), sourceSlug: 'another-venue-source' }), /ENOENT/);
  });
});

test('a venue without the selected locale alt uses the direct image fallback, matching destination behavior', async () => {
  await fixtureRoot(async root => {
    await addUntranslatedSource(root);
    const cover = { src: '/images/blog/unavailable-venue.webp', small: '/images/blog/unavailable-venue-640.webp', share: '/images/blog/unavailable-venue-share.jpg', alt: { sl: 'Samo slovenski opis' } };
    const before = await readFile(join(root, imagesPath), 'utf8');
    await writeFile(join(root, imagesPath), before.replace("const VENUE_IMAGES = { venue: { src: '/images/blog/venue.webp' } };", `const VENUE_IMAGES = ${JSON.stringify({ 'untranslated-source': cover })};`));
    const change = await ocenagorAdapter.prepare(root, 'hr', localizedDraft('hr'), localizedMetadata('hr'));
    assert.equal(change.articleUrl, 'https://ocjenagor.hr/blog/novi-lokalni-vodic');
  });
});
