import ts from 'typescript';

function parse(source: string) {
  const file = ts.createSourceFile('content.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics?.length) throw new Error('The source file contains TypeScript syntax errors. Review it before preparing content.');
  return file;
}
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return unwrap(node.expression);
  return node;
}
function value(node: ts.Expression): unknown {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => { if (ts.isSpreadElement(item) || ts.isOmittedExpression(item)) throw new Error('Spread/computed content is not supported; no code was evaluated.'); return value(item); });
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))) throw new Error('Computed content is not supported; no code was evaluated.');
      const key = property.name.text;
      if (Object.hasOwn(result, key)) throw new Error('Duplicate content properties must be resolved before preparing changes.');
      result[key] = value(property.initializer);
    }
    return result;
  }
  throw new Error('This source uses computed content. A reviewed adapter is required; no code was evaluated.');
}
function exported(file: ts.SourceFile, variableName: string, requireExport = true): ts.Expression {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || (requireExport && !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName && declaration.initializer) return unwrap(declaration.initializer);
    }
  }
  throw new Error(`Expected exported content variable '${variableName}' was not found.`);
}
export function readLiteralExport(source: string, variableName: string): unknown {
  return value(exported(parse(source), variableName));
}
export function upsertArray(source: string, variableName: string, arrayPath: string[], article: Record<string, unknown>): string {
  const file = parse(source);
  let node = exported(file, variableName);
  for (const key of arrayPath) {
    if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected an object containing the article list.');
    const properties = node.properties.filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key);
    if (properties.length !== 1) throw new Error(`Expected one '${key}' content property.`);
    node = unwrap(properties[0].initializer);
  }
  if (!ts.isArrayLiteralExpression(node)) throw new Error('Expected a literal article array.');
  if (typeof article.slug !== 'string') throw new Error('Article slug is required.');
  const entries = node.elements.map(item => {
    if (ts.isSpreadElement(item) || ts.isOmittedExpression(item)) throw new Error('Computed arrays cannot be updated safely.');
    const itemValue = value(item);
    if (!itemValue || typeof itemValue !== 'object' || !('slug' in itemValue)) throw new Error('Existing article has no slug.');
    return { node: item, data: itemValue as { slug: string } };
  });
  const matches = entries.filter(item => item.data.slug === article.slug);
  if (matches.length > 1) throw new Error('Duplicate source slugs must be resolved before preparing changes.');
  // JSON string literals are valid TypeScript. Escape line separators for portable patches.
  const literal = JSON.stringify(article, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (matches.length) {
    const item = matches[0].node;
    const column = item.getStart(file) - source.lastIndexOf('\n', item.getStart(file) - 1) - 1;
    const rendered = literal.replace(/\n/g, '\n' + ' '.repeat(column));
    const next = source.slice(0, item.getStart(file)) + rendered + source.slice(item.end);
    parse(next); return next;
  }
  const rendered = literal.split('\n').map(line => `  ${line}`).join('\n');
  const insertion = node.getStart(file) + 1;
  const next = source.slice(0, insertion) + `\n${rendered},` + source.slice(insertion);
  parse(next); return next;
}
export function parseSections(content: string): { heading: string; paragraphs: string[] }[] {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current = { heading: '', paragraphs: [] as string[] };
  let lines: string[] = [];
  const flushParagraph = () => { const text = lines.join('\n').trim(); if (text) current.paragraphs.push(text); lines = []; };
  const flushSection = () => { flushParagraph(); if (current.paragraphs.length) sections.push(current); };
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (/^##\s+/.test(line)) { flushSection(); current = { heading: line.replace(/^##\s+/, '').trim(), paragraphs: [] }; }
    else if (!line.trim()) flushParagraph();
    else lines.push(line);
  }
  flushSection();
  return sections;
}

export function readLiteralVariable(source: string, variableName: string): unknown {
  return value(exported(parse(source), variableName, false));
}
export function upsertObjectProperty(source: string, variableName: string, key: string, data: unknown): string {
  const file = parse(source);
  const node = exported(file, variableName, false);
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected a literal metadata object.');
  // Validate every existing property before altering a trusted content registry.
  value(node);
  const matches = node.properties.filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key);
  if (matches.length > 1) throw new Error('Duplicate metadata properties must be resolved first.');
  const literal = JSON.stringify(data, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  let result: string;
  if (matches.length) {
    const original = matches[0].initializer;
    const column = original.getStart(file) - source.lastIndexOf('\n', original.getStart(file) - 1) - 1;
    result = source.slice(0, original.getStart(file)) + literal.replace(/\n/g, '\n' + ' '.repeat(column)) + source.slice(original.end);
  } else {
    const insertion = node.getStart(file) + 1;
    const property = `${JSON.stringify(key)}: ${literal}`.split('\n').map(line => `  ${line}`).join('\n');
    result = source.slice(0, insertion) + `\n${property},` + source.slice(insertion);
  }
  parse(result); return result;
}
