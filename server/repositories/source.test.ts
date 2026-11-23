import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSections, readLiteralExport, upsertArray } from './source.js';

const normal = (value: unknown) => JSON.parse(JSON.stringify(value));

test('content literal inspection never executes top-level or computed source', () => {
  const marker = '__blogmachineSourceInspectionMarker';
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals[marker];
  try {
    const source = `globalThis.${marker} = 'executed';\nexport const posts = [{ slug: "safe", title: "Literal article" }];`;
    assert.deepEqual(normal(readLiteralExport(source, 'posts')), [{ slug: 'safe', title: 'Literal article' }]);
    assert.equal(globals[marker], undefined);
    assert.throws(() => readLiteralExport(`export const posts = (() => { globalThis.${marker} = 'executed'; return []; })();`, 'posts'), /computed content/i);
    assert.equal(globals[marker], undefined);
    assert.throws(() => readLiteralExport('export const posts = [{ ...unknown }];', 'posts'), /computed content/i);
    assert.throws(() => readLiteralExport('export const posts = [{ [unknown]: "value" }];', 'posts'), /computed content/i);
    assert.throws(() => readLiteralExport('export const posts = [;', 'posts'), /syntax errors/i);
  } finally { delete globals[marker]; }
});

test('source upsert preserves unrelated code and serializes hostile-looking text as strings', () => {
  const before = '// Keep this comment.\nexport const blog = { title: "Our stories", posts: [{ slug: "first", title: "Original" }] };\nexport function helper() { return "kept"; }\n';
  const title = 'A quote: "; globalThis.injection = true; //\nA new line \u2028next';
  const after = upsertArray(before, 'blog', ['posts'], { slug: 'new', title });
  assert.ok(after.startsWith('// Keep this comment.\n'));
  assert.ok(after.endsWith('export function helper() { return "kept"; }\n'));
  assert.ok(after.includes('\\u2028'));
  assert.deepEqual(normal(readLiteralExport(after, 'blog')), { title: 'Our stories', posts: [{ slug: 'new', title }, { slug: 'first', title: 'Original' }] });
  const updated = upsertArray(after, 'blog', ['posts'], { slug: 'new', title: 'Updated once' });
  assert.deepEqual(normal(readLiteralExport(updated, 'blog')), { title: 'Our stories', posts: [{ slug: 'new', title: 'Updated once' }, { slug: 'first', title: 'Original' }] });
});

test('source upsert refuses ambiguous slug collections instead of replacing multiple posts', () => {
  const source = 'export const posts = [{slug: "same", title: "One"}, {slug: "same", title: "Two"}];';
  assert.throws(() => upsertArray(source, 'posts', [], { slug: 'same', title: 'Replacement' }), /Duplicate source slugs/i);
  assert.throws(() => readLiteralExport('export const posts = [{ slug: "one", slug: "two" }];', 'posts'), /Duplicate content properties/i);
});

test('plain-text section parsing preserves paragraphs and separates marked headings', () => {
  assert.deepEqual(parseSections('An introduction.\r\n\r\n## First section\r\nLine one\r\nline two\r\n\r\nAnother paragraph.\r\n\r\n## Second section\r\nFinal words.'), [
    { heading: '', paragraphs: ['An introduction.'] },
    { heading: 'First section', paragraphs: ['Line one\nline two', 'Another paragraph.'] },
    { heading: 'Second section', paragraphs: ['Final words.'] },
  ]);
});
