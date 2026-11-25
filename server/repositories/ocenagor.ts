import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import ts from 'typescript';
import { parseSections, readLiteralExport, readLiteralVariable, upsertArray, upsertObjectProperty } from './source.js';
import type { ArticleSummary, ContentDraft, GitAdapter, RepoTarget } from './types.js';

const contentPath = 'src/content/blog/sl.ts';
const imagesPath = 'src/content/blog/images.ts';
const localizationPath = 'src/content/blog/localization.ts';
const moduleNames = ['localization', 'hr', 'hr-products', 'hr-booking', 'it', 'it-products', 'it-booking'] as const;
const sharedPaths = ['src/content/blog/index.ts', imagesPath, ...moduleNames.map(name => `src/content/blog/${name}.ts`)];
export const ocenagorCategories = ['Google profil', 'Google ocene', 'NFC komponente', 'Digitalni meni', 'AI telefonist', 'Rezervacije miz', 'Rezervacije terminov', 'Spletne strani'] as const;
export const ocenagorIcons = ['profile', 'reviews', 'nfc', 'reply'] as const;
const targets: RepoTarget[] = [
  { key: 'si', label: 'OcenaGor.si · Slovenščina', url: 'https://ocenagor.si', locale: 'sl', contentPath, deployment: 'Review the SI patch and run destination type, content, and SEO checks. Merge through the confirmed main branch and Netlify SI tenant build (VITE_TENANT=si); verify the Slovenian canonical URL after deployment.' },
  { key: 'hr', label: 'OcjenaGor.hr · Hrvatski', url: 'https://ocjenagor.hr', locale: 'hr', contentPath: 'src/content/blog/hr.ts', deployment: 'Review the Croatian patch and run HR tenant checks. After merging, dispatch .github/workflows/deploy.yml with selected market hr. Build with VITE_TENANT=hr and deploy its separate Cloudflare Worker; do not reuse another tenant’s dist output.' },
  { key: 'it', label: 'ValutoSu.it · Italiano', url: 'https://valutosu.it', locale: 'it', contentPath: 'src/content/blog/it.ts', deployment: 'Review the Italian patch and run IT tenant checks. After merging, dispatch .github/workflows/deploy.yml with selected market it. Build with VITE_TENANT=it and deploy its separate Cloudflare Worker; do not reuse another tenant’s dist output.' },
].map(target => ({ ...target, additionalPaths: [contentPath, ...sharedPaths].filter(path => path !== target.contentPath) }));
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
  sources: z.array(sourceSchema).max(30), seoTitle: plainText(250), imageAlt: plainText(2000),
};
const metadataSchema = z.object(metadataFields).partial().strict();
const newMetadataSchema = metadataSchema.required({ category: true, icon: true, publishedAt: true, primaryKeyword: true, takeaway: true, ctaTemplateSlug: true, imageSourceSlug: true });
const assetPath = z.string().regex(/^\/images\/blog\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/, 'Choose an existing blog image asset.').refine(value => value.split('/').every((part, index) => index === 0 || (part !== '' && part !== '.' && part !== '..')), 'Image assets must stay in the blog image directory.');
const imageSchema = z.object({
  src: assetPath, small: assetPath, share: assetPath, alt: plainText(2000),
  author: z.string().optional(), provider: z.string().optional(), source: httpsUrl.optional(),
  venue: z.string().optional(), license: httpsUrl.optional(), published: dateSchema.optional(), productImage: z.boolean().optional(),
}).passthrough();

function selectedTarget(key: string): RepoTarget {
  const target = targets.find(item => item.key === key);
  if (!target) throw new Error('Select a supported OcenaGor family destination: si, hr, or it.');
  return target;
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
function optionalLiteral(source: string, name: string): unknown {
  try { return readLiteralVariable(source, name); }
  catch (error) {
    if (error instanceof Error && error.message === `Expected exported content variable '${name}' was not found.`) return undefined;
    throw error;
  }
}
function effectiveCover(source: string, sourceSlug: string, locale: string) {
  // Match the destination's blogImageFor ordering. Venue covers use canonical
  // Slovenian source slugs and carry their own per-language alternative text.
  const coverSources = z.record(z.string(), slugSchema).parse(optionalLiteral(source, 'VENUE_COVER_SOURCE') ?? {});
  const venues = z.record(z.string(), z.unknown()).parse(optionalLiteral(source, 'VENUE_IMAGES') ?? {});
  const venue = venues[coverSources[sourceSlug] ?? sourceSlug];
  if (venue && typeof venue === 'object') {
    const value = venue as Record<string, unknown>;
    const alternative = value.alt && typeof value.alt === 'object' ? (value.alt as Record<string, unknown>)[locale] : undefined;
    if (alternative) return imageSchema.parse({ ...value, alt: alternative });
  }
  const images = readImages(source);
  return Object.hasOwn(images, sourceSlug) ? images[sourceSlug] : undefined;
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


const localizedArticleSchema = z.object({
  slug: slugSchema, title: plainText(250), seoTitle: plainText(250), keyword: plainText(500),
  description: plainText(1000), takeaway: plainText(5000), imageAlt: plainText(2000),
  sections: z.array(sectionSchema.extend({ related: z.array(z.string()).optional() })).min(1),
  cta: ctaSchema.optional(), sources: z.array(sourceSchema).optional(),
  published: dateSchema.optional(), updated: dateSchema.optional(),
  leadOffer: articleSchema.shape.leadOffer,
}).passthrough();
const localizedMetadataSchema = z.object({
  sourceSlug: slugSchema, seoTitle: plainText(250), primaryKeyword: plainText(500),
  takeaway: plainText(5000), imageAlt: plainText(2000), ctaTemplateSlug: slugSchema,
  publishedAt: dateSchema, sources: z.array(sourceSchema).max(30),
}).partial().strict();
const newLocalizedMetadataSchema = localizedMetadataSchema.required({
  sourceSlug: true, seoTitle: true, primaryKeyword: true, takeaway: true, imageAlt: true, ctaTemplateSlug: true,
});
type LocalizedArticle = z.infer<typeof localizedArticleSchema>;
type Article = z.infer<typeof articleSchema>;
type Module = { path: string; source: string; file: ts.SourceFile; variables: Map<string, ts.Expression>; imports: Map<string, { module: string; name: string }> };
type Location = { module: Module; expression: ts.Expression };
type Version = { targetKey: string; locale: string; slug: string; title: string; url: string };
type FamilyArticle = ArticleSummary & { sourceSlug: string; articleKey?: string; seoTitle: string; primaryKeyword: string; takeaway: string; imageAlt?: string; versions: Version[] };

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) ? unwrap(node.expression) : node;
}
function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error('Computed content keys are not supported; no code was evaluated.');
}
function parseModule(path: string, source: string): Module {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) throw new Error('The content file contains TypeScript syntax errors.');
  const variables = new Map<string, ts.Expression>();
  const imports = new Map<string, { module: string; name: string }>();
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (variables.has(declaration.name.text)) throw new Error('Duplicate content variables must be resolved before preparing changes.');
      variables.set(declaration.name.text, unwrap(declaration.initializer));
    }
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names = statement.importClause.namedBindings;
      if (!names || !ts.isNamedImports(names)) continue;
      for (const binding of names.elements) if (!binding.isTypeOnly) imports.set(binding.name.text, { module: statement.moduleSpecifier.text, name: binding.propertyName?.text ?? binding.name.text });
    }
  }
  return { path, source, file, variables, imports };
}

/** Interpret this repository's literal data grammar; never execute website code. */
async function loadFamily(root: string, overrides: Map<string, string> = new Map()) {
  const modules = new Map<string, Module>();
  for (const name of moduleNames) {
    const path = `src/content/blog/${name}.ts`;
    modules.set(name, parseModule(path, overrides.get(path) ?? await readSource(root, path)));
  }
  const localization = modules.get('localization')!;
  const helper = localization.file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'section');
  const scanner = (source: string) => {
    const tokens = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
    const result: string[] = [];
    for (let token = tokens.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = tokens.scan()) result.push(`${token}:${tokens.getTokenValue() || tokens.getTokenText()}`);
    return result.join('|');
  };
  const expectedHelper = '{ return { id, title, paragraphs: typeof paragraphs === \'string\' ? [paragraphs] : paragraphs, ...details }; }';
  if (!helper?.body || helper.asteriskToken || helper.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) || helper.parameters.map(parameter => ts.isIdentifier(parameter.name) ? parameter.name.text : '').join(',') !== 'id,title,paragraphs,details' || scanner(helper.body.getText(localization.file)) !== scanner(expectedHelper)) throw new Error('The localized section helper changed. Review its data contract before preparing content; no code was evaluated.');
  const evaluating = new Set<ts.Expression>();
  function moduleForImport(module: Module, name: string): { module: Module; name: string } | undefined {
    const binding = module.imports.get(name);
    if (!binding) return;
    const imported = binding.module.match(/^\.\/([a-z-]+)$/)?.[1];
    const target = imported ? modules.get(imported) : undefined;
    if (!target) throw new Error('Only the inspected local blog data imports are supported; no code was evaluated.');
    return { module: target, name: binding.name };
  }
  function resolveIdentifier(module: Module, node: ts.Identifier): Location {
    const expression = module.variables.get(node.text);
    if (expression) return { module, expression };
    const imported = moduleForImport(module, node.text);
    const importedExpression = imported?.module.variables.get(imported.name);
    if (imported && importedExpression) return { module: imported.module, expression: importedExpression };
    throw new Error('Only inspected literal blog variables are supported; no code was evaluated.');
  }
  function evaluate(module: Module, expression: ts.Expression): unknown {
    const node = unwrap(expression);
    if (evaluating.has(node)) throw new Error('Circular content data is unsupported; no code was evaluated.');
    evaluating.add(node);
    try {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isIdentifier(node)) { const next = resolveIdentifier(module, node); return evaluate(next.module, next.expression); }
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => {
        if (ts.isSpreadElement(item) || ts.isOmittedExpression(item)) throw new Error('Computed arrays are unsupported; no code was evaluated.');
        return evaluate(module, item);
      });
      if (ts.isObjectLiteralExpression(node)) {
        const result: Record<string, unknown> = Object.create(null);
        for (const property of node.properties) {
          let fields: Record<string, unknown>;
          if (ts.isSpreadAssignment(property)) fields = z.record(z.string(), z.unknown()).parse(evaluate(module, property.expression));
          else if (ts.isPropertyAssignment(property)) fields = { [propertyName(property.name)]: evaluate(module, property.initializer) };
          else throw new Error('Computed object content is unsupported; no code was evaluated.');
          for (const [key, value] of Object.entries(fields)) {
            if (Object.hasOwn(result, key)) throw new Error('Duplicate content properties must be resolved before preparing changes.');
            result[key] = value;
          }
        }
        return result;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const helper = module.imports.get(node.expression.text);
        if (helper?.module !== './localization' || helper.name !== 'section' || node.arguments.length < 3 || node.arguments.length > 4) throw new Error('Only the inspected section data helper is supported; no code was evaluated.');
        const [id, title, body, details = {}] = node.arguments.map(argument => evaluate(module, argument));
        const extra = z.record(z.string(), z.unknown()).parse(details);
        if (['id', 'title', 'paragraphs'].some(key => Object.hasOwn(extra, key))) throw new Error('Section details cannot overwrite the section identity or text.');
        return { id: slugSchema.parse(id), title: plainText(1000).parse(title), paragraphs: typeof body === 'string' ? [body] : z.array(z.string()).parse(body), ...extra };
      }
      throw new Error('This source uses unsupported computed content; no code was evaluated.');
    } finally { evaluating.delete(node); }
  }
  function variable(moduleName: string, name: string): unknown {
    const module = modules.get(moduleName);
    const expression = module?.variables.get(name);
    if (!module || !expression) throw new Error(`Expected blog data variable '${name}' was not found.`);
    return evaluate(module, expression);
  }
  function locate(module: Module, expression: ts.Expression, keys: string[]): Location {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) { const next = resolveIdentifier(module, node); return locate(next.module, next.expression, keys); }
    if (!keys.length) return { module, expression: node };
    if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected a literal localized article object.');
    const [head, ...tail] = keys;
    const matches: Location[] = [];
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && propertyName(property.name) === head) matches.push(locate(module, property.initializer, tail));
      else if (ts.isSpreadAssignment(property)) {
        const data = evaluate(module, property.expression);
        if (data && typeof data === 'object' && Object.hasOwn(data, head)) matches.push(locate(module, property.expression, keys));
      }
    }
    if (matches.length !== 1) throw new Error('Expected one unambiguous localized article location.');
    return matches[0];
  }
  const mapping = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), slugSchema).parse(variable('localization', 'articleKeys'));
  if (new Set(Object.values(mapping)).size !== Object.keys(mapping).length) throw new Error('Article translation keys must have unique Slovenian source slugs.');
  const translations = Object.fromEntries(['hr', 'it'].map(locale => {
    const translation = z.object({ copy: z.object({ nextTitle: plainText(1000), nextText: plainText(5000), componentsAction: plainText(500) }).passthrough(), categories: z.record(z.string(), z.string()), articles: z.record(z.string(), localizedArticleSchema) }).passthrough().parse(variable(locale, locale));
    if (new Set(Object.values(translation.articles).map(article => article.slug)).size !== Object.keys(translation.articles).length) throw new Error(`Resolve duplicate ${locale} article slugs before preparing content.`);
    for (const key of Object.keys(translation.articles)) if (!Object.hasOwn(mapping, key)) throw new Error('A localized article has no registered Slovenian counterpart. Review the translation registry.');
    return [locale, translation];
  })) as Record<'hr' | 'it', { copy: { nextTitle: string; nextText: string; componentsAction: string }; categories: Record<string, string>; articles: Record<string, LocalizedArticle> }>;
  return { modules, mapping, translations, locate, evaluate };
}

function renderLiteral(data: unknown): string {
  return JSON.stringify(data, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function replaceLiteral(location: Location, data: unknown): string {
  const { module, expression } = location;
  const column = expression.getStart(module.file) - module.source.lastIndexOf('\n', expression.getStart(module.file) - 1) - 1;
  const rendered = renderLiteral(data).replace(/\n/g, '\n' + ' '.repeat(column));
  return module.source.slice(0, expression.getStart(module.file)) + rendered + module.source.slice(expression.end);
}
function insertProperty(location: Location, key: string, data: unknown): string {
  const node = unwrap(location.expression);
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected a literal localized article registry.');
  if (node.properties.some(property => ts.isPropertyAssignment(property) && propertyName(property.name) === key)) throw new Error('The article already exists in this registry.');
  const insertion = node.getStart(location.module.file) + 1;
  const rendered = `${JSON.stringify(key)}: ${renderLiteral(data)}`.split('\n').map(line => `    ${line}`).join('\n');
  return location.module.source.slice(0, insertion) + `\n${rendered},` + location.module.source.slice(insertion);
}

function ensureArticleKey(model: Awaited<ReturnType<typeof loadFamily>>, sourceSlug: string) {
  const current = Object.entries(model.mapping).find(([, slug]) => slug === sourceSlug)?.[0];
  if (current) return { key: current };
  const key = `editorial_${sourceSlug.replace(/-/g, '_')}`;
  if (Object.hasOwn(model.mapping, key)) throw new Error('The generated editorial translation key is already used by another article.');
  const module = model.modules.get('localization')!;
  const registry = module.variables.get('editorialArticleKeys');
  let after: string;
  if (registry) {
    const articles = module.variables.get('articleKeys');
    if (!articles || !ts.isObjectLiteralExpression(articles) || !articles.properties.some(property => ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) && property.expression.text === 'editorialArticleKeys')) throw new Error('The editorial registry must be included in articleKeys before preparing content.');
    const translation = module.file.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === 'BlogTranslation');
    let optional = false;
    function checkType(node: ts.Node) {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Partial') {
        function findEditorial(child: ts.Node) {
          if (ts.isTypeQueryNode(child) && ts.isIdentifier(child.exprName) && child.exprName.text === 'editorialArticleKeys') optional = true;
          ts.forEachChild(child, findEditorial);
        }
        ts.forEachChild(node, findEditorial);
      }
      ts.forEachChild(node, checkType);
    }
    if (translation) checkType(translation);
    if (!optional) throw new Error('The editorial registry must remain optional in the translation schema.');
    after = upsertObjectProperty(module.source, 'editorialArticleKeys', key, sourceSlug);
  } else {
    const articles = module.variables.get('articleKeys');
    if (!articles || !ts.isObjectLiteralExpression(articles)) throw new Error('The translation key registry needs review before adding editorial articles.');
    const translation = module.file.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === 'BlogTranslation');
    const articlesType = translation?.members.find((member): member is ts.PropertySignature => ts.isPropertySignature(member) && propertyName(member.name) === 'articles')?.type;
    let partialKey: ts.TypeNode | undefined;
    function findPartial(node: ts.Node) {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Partial') {
        const record = node.typeArguments?.[0];
        if (record && ts.isTypeReferenceNode(record) && ts.isIdentifier(record.typeName) && record.typeName.text === 'Record') partialKey = record.typeArguments?.[0];
      }
      ts.forEachChild(node, findPartial);
    }
    if (articlesType) findPartial(articlesType);
    if (!partialKey) throw new Error('The optional translation type needs review before adding editorial articles.');
    const insertions = [
      { at: partialKey.end, text: ' | keyof typeof editorialArticleKeys' },
      { at: articles.end - 1, text: `${articles.properties.hasTrailingComma ? '' : ','} ...editorialArticleKeys ` },
      { at: module.file.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'articleKeys'))?.getStart(module.file) ?? -1, text: `const editorialArticleKeys = ${renderLiteral({ [key]: sourceSlug })} as const;\n\n` },
    ];
    if (insertions.some(item => item.at < 0)) throw new Error('The article registry declaration needs review.');
    after = insertions.sort((a, b) => b.at - a.at).reduce((source, insertion) => source.slice(0, insertion.at) + insertion.text + source.slice(insertion.at), module.source);
  }
  parseModule(localizationPath, after);
  return { key, change: { relativePath: localizationPath, before: module.source, after } };
}

function localizedCta(model: Awaited<ReturnType<typeof loadFamily>>, locale: 'hr' | 'it', key: string, source: Article) {
  const translation = model.translations[locale];
  const article = translation.articles[key];
  if (!article) throw new Error('Choose an existing article in this destination language as the CTA template.');
  if (article.cta) return article.cta;
  const hrefs: Record<string, Record<'hr' | 'it', string>> = {
    '/google-ocene': { hr: '/google-ocjene', it: '/recensioni-google' },
    '/#narocilo': { hr: '/#narudzba', it: '/#ordine' },
    '/#primerjava': { hr: '/#usporedba', it: '/#confronto' },
  };
  const href = hrefs[source.cta.href]?.[locale];
  if (!href) throw new Error('This template has no explicit localized CTA. Choose another same-language article with a localized CTA.');
  return ctaSchema.parse({ title: translation.copy.nextTitle, text: translation.copy.nextText, label: translation.copy.componentsAction, href });
}

function familyVersions(posts: Article[], model: Awaited<ReturnType<typeof loadFamily>>, sourceSlug: string): Version[] {
  const source = posts.find(post => post.slug === sourceSlug);
  if (!source) throw new Error('A localized article references a missing Slovenian source.');
  const key = Object.entries(model.mapping).find(([, slug]) => slug === sourceSlug)?.[0];
  const versions: Version[] = [{ targetKey: 'si', locale: 'sl', slug: source.slug, title: source.title, url: `${targets[0].url}/blog/${source.slug}` }];
  for (const target of targets.slice(1)) {
    const article = key ? model.translations[target.locale as 'hr' | 'it'].articles[key] : undefined;
    if (article) versions.push({ targetKey: target.key, locale: target.locale, slug: article.slug, title: article.title, url: `${target.url}/blog/${article.slug}` });
  }
  return versions;
}

export const ocenagorAdapter: GitAdapter = {
  id: 'ocenagor', targets,
  async list(root, targetKey): Promise<FamilyArticle[]> {
    const target = selectedTarget(targetKey);
    const posts = readPosts(await readSource(root, contentPath));
    const model = await loadFamily(root);
    if (target.key === 'si') return posts.map(post => ({
      slug: post.slug, title: post.title, description: post.description, url: `${target.url}/blog/${post.slug}`,
      sourceSlug: post.slug, articleKey: Object.entries(model.mapping).find(([, slug]) => slug === post.slug)?.[0],
      seoTitle: post.seoTitle, primaryKeyword: post.primaryKeyword, takeaway: post.takeaway, imageAlt: post.imageAlt,
      versions: familyVersions(posts, model, post.slug),
    }));
    const locale = target.locale as 'hr' | 'it';
    return Object.entries(model.translations[locale].articles).map(([key, article]) => {
      const sourceSlug = model.mapping[key];
      return { slug: article.slug, title: article.title, description: article.description, url: `${target.url}/blog/${article.slug}`,
        sourceSlug, articleKey: key, seoTitle: article.seoTitle, primaryKeyword: article.keyword, takeaway: article.takeaway, imageAlt: article.imageAlt,
        versions: familyVersions(posts, model, sourceSlug) };
    });
  },
  async prepare(root, targetKey, input, metadata) {
    const target = selectedTarget(targetKey);
    const draft = draftSchema.parse(input);
    const sourceBefore = await readSource(root, contentPath);
    const posts = readPosts(sourceBefore);
    const model = await loadFamily(root);
    const changes: { relativePath: string; before: string; after: string }[] = [];
    if (target.key !== 'si') {
      const locale = target.locale as 'hr' | 'it';
      const fields = localizedMetadataSchema.parse(metadata);
      const entries = model.translations[locale].articles;
      const existingEntry = Object.entries(entries).find(([, article]) => article.slug === draft.slug);
      const existing = existingEntry?.[1];
      const sourceSlug = existingEntry ? model.mapping[existingEntry[0]] : fields.sourceSlug;
      if (!sourceSlug) throw new Error('Choose the Slovenian source article to pair with this language version.');
      if (fields.sourceSlug && fields.sourceSlug !== sourceSlug) throw new Error('This localized slug is already paired with a different Slovenian source article.');
      const source = posts.find(post => post.slug === sourceSlug);
      if (!source) throw new Error('Choose an existing Slovenian source article before preparing a translated version.');
      const registration = ensureArticleKey(model, sourceSlug);
      const key = registration.key;
      if (!existing && Object.hasOwn(entries, key)) throw new Error('This source already has a version in the selected language. Use its existing localized slug to update it; changing a published slug requires a separate redirect review.');
      if (registration.change) changes.push(registration.change);
      let article: LocalizedArticle;
      if (existing) {
        if (fields.ctaTemplateSlug !== undefined) throw new Error('Existing localized articles keep their current CTA. Templates are for new language versions only.');
        const published = existing.published ?? '2026-11-11';
        if (fields.publishedAt && fields.publishedAt < published) throw new Error('The update date cannot be earlier than the original localized publication date.');
        article = {
          ...existing, title: draft.title, description: draft.excerpt, sections: sectionsFor(draft),
          ...(fields.seoTitle !== undefined ? { seoTitle: fields.seoTitle } : {}),
          ...(fields.primaryKeyword !== undefined ? { keyword: fields.primaryKeyword } : {}),
          ...(fields.takeaway !== undefined ? { takeaway: fields.takeaway } : {}),
          ...(fields.imageAlt !== undefined ? { imageAlt: fields.imageAlt } : {}),
          ...(fields.sources !== undefined ? { sources: fields.sources } : {}),
          ...(fields.publishedAt !== undefined ? { updated: fields.publishedAt } : {}),
        };
      } else {
        const required = newLocalizedMetadataSchema.parse(metadata);
        const templateEntry = Object.entries(entries).find(([, article]) => article.slug === required.ctaTemplateSlug);
        if (!templateEntry) throw new Error('Choose an existing article in this destination language as the CTA template.');
        const templateSource = posts.find(post => post.slug === model.mapping[templateEntry[0]]);
        if (!templateSource) throw new Error('The CTA template has no valid Slovenian source pairing.');
        const image = effectiveCover(await readSource(root, imagesPath), sourceSlug, locale);
        if (!image) throw new Error('The Slovenian source needs an approved localized venue cover or BLOG_IMAGES fallback before creating a language version.');
        await validateImageAssets(root, image);
        article = {
          slug: draft.slug, title: draft.title, seoTitle: required.seoTitle, keyword: required.primaryKeyword,
          description: draft.excerpt, takeaway: required.takeaway, imageAlt: required.imageAlt, sections: sectionsFor(draft),
          published: required.publishedAt ?? new Date().toISOString().slice(0, 10), sources: required.sources ?? [],
          cta: localizedCta(model, locale, templateEntry[0], templateSource),
        };
      }
      localizedArticleSchema.parse(article);
      const module = model.modules.get(locale)!;
      if (existingEntry) {
        const location = model.locate(module, module.variables.get(locale)!, ['articles', existingEntry[0]]);
        changes.unshift({ relativePath: location.module.path, before: location.module.source, after: replaceLiteral(location, article) });
      } else {
        const location = model.locate(module, module.variables.get(locale)!, ['articles']);
        changes.unshift({ relativePath: module.path, before: module.source, after: insertProperty(location, key, article) });
      }
    } else {
      const fields = metadataSchema.parse(metadata);
      const existing = posts.find(post => post.slug === draft.slug);
      const sections = sectionsFor(draft);
      let article: Record<string, unknown>;
      if (existing) {
        if (fields.imageSourceSlug !== undefined || fields.ctaTemplateSlug !== undefined) throw new Error('Existing articles keep their current cover image and CTA. Image and CTA templates are for new articles only.');
        if (fields.publishedAt && fields.publishedAt < existing.published) throw new Error('The update date cannot be earlier than the original publication date.');
        article = { ...existing, title: draft.title, seoTitle: fields.seoTitle ?? draft.title, description: draft.excerpt, sections,
          ...(fields.category !== undefined ? { category: fields.category } : {}), ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
          ...(fields.primaryKeyword !== undefined ? { primaryKeyword: fields.primaryKeyword } : {}), ...(fields.takeaway !== undefined ? { takeaway: fields.takeaway } : {}),
          ...(fields.imageAlt !== undefined ? { imageAlt: fields.imageAlt } : {}), ...(fields.sources !== undefined ? { sources: fields.sources } : {}),
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
        article = { slug: draft.slug, title: draft.title, seoTitle: required.seoTitle ?? draft.title, primaryKeyword: required.primaryKeyword,
          description: draft.excerpt, category: required.category, icon: required.icon, published: required.publishedAt,
          takeaway: required.takeaway, sections, sources: required.sources ?? [], cta: template.cta,
          ...(required.imageAlt !== undefined ? { imageAlt: required.imageAlt } : {}),
        };
        const imageAfter = upsertObjectProperty(imageBefore, 'BLOG_IMAGES', draft.slug, image);
        readImages(imageAfter);
        changes.push({ relativePath: imagesPath, before: imageBefore, after: imageAfter });
        const registration = ensureArticleKey(model, draft.slug);
        if (registration.change) changes.push(registration.change);
      }
      articleSchema.parse(article);
      const after = upsertArray(sourceBefore, 'BLOG_POSTS', [], article);
      readPosts(after);
      changes.unshift({ relativePath: contentPath, before: sourceBefore, after });
    }
    const validated = await loadFamily(root, new Map(changes.map(change => [change.relativePath, change.after])));
    const nextPosts = readPosts(changes.find(change => change.relativePath === contentPath)?.after ?? sourceBefore);
    // Every prepared language version must remain visible through the site's
    // canonical source-key relationship, rather than becoming an orphan record.
    for (const locale of ['hr', 'it'] as const) for (const key of Object.keys(validated.translations[locale].articles)) {
      if (!nextPosts.some(post => post.slug === validated.mapping[key])) throw new Error('A localized article would lose its canonical Slovenian source.');
    }
    const [primary, ...additionalChanges] = changes;
    return { ...primary, articleUrl: `${target.url}/blog/${draft.slug}`, ...(additionalChanges.length ? { additionalChanges } : {}) };
  },
};
