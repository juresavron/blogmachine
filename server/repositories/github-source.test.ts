import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ensureGitHubSource, GitHubSourceError, githubSourceIdentity, isGitHubSourceRoot } from './github-source.js';

const repository = 'juresavron/ocenagor-landing-lovable-13';
const api = `https://api.github.com/repos/${repository}`;
const headA = 'a'.repeat(40), headB = 'b'.repeat(40), treeSha = 'c'.repeat(40);
const paths = [
  'src/content/blog/sl.ts', 'src/content/blog/images.ts', 'src/content/blog/localization.ts', 'src/content/blog/index.ts',
  'src/content/blog/hr.ts', 'src/content/blog/hr-products.ts', 'src/content/blog/hr-booking.ts',
  'src/content/blog/it.ts', 'src/content/blog/it-products.ts', 'src/content/blog/it-booking.ts',
  'src/tenants/si.ts', 'src/tenants/hr.ts', 'src/tenants/it.ts', 'src/tenants/index.ts', 'src/tenants/types.ts',
];
function sha(bytes: Buffer) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const hasCode = (code: GitHubSourceError['code']) => (error: unknown) => error instanceof GitHubSourceError && error.code === code;
async function fixture(t: TestContext) {
  const cacheDirectory = await mkdtemp(resolve(tmpdir(), 'blogmachine-github-test-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const files = new Map(paths.map((path, index) => [path, Buffer.from(`export const fixture${index} = ${index};\n`)]));
  const asset = 'public/images/blog/cover.webp';
  files.set('src/content/blog/images.ts', Buffer.from('const BLOG_IMAGES = { guide: { src: "/images/blog/cover.webp", small: "/images/blog/cover.webp", share: "/images/blog/cover.webp", alt: "Approved cover" } };\n'));
  files.set(asset, Buffer.from('An image fixture\0with bytes'));
  files.set('private/secrets.txt', Buffer.from('must never be fetched'));
  const state = { head: headA, treeTruncated: false, mismatchBlob: false, mismatchCommit: false, moveDuringDownload: false, status: 200, count: 0, treeMutator: (entries: Record<string, unknown>[]) => entries };
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    assert(url.startsWith(api + '/git/'), 'Every request stays on the fixed GitHub API repository.');
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    if (state.status !== 200) return json({ message: 'private upstream detail must not escape' }, state.status);
    if (url === api + '/git/ref/heads/main') return json({ ref: 'refs/heads/main', object: { type: 'commit', sha: state.head } });
    if (url.startsWith(api + '/git/commits/')) return json({ sha: state.mismatchCommit ? headB : url.split('/').at(-1), tree: { sha: treeSha } });
    if (url === api + `/git/trees/${treeSha}?recursive=1`) {
      const entries = [...files].map(([path, bytes]) => ({ path, mode: '100644', type: 'blob', sha: sha(bytes), size: bytes.length }));
      return json({ sha: treeSha, truncated: state.treeTruncated, tree: state.treeMutator(entries) });
    }
    if (url.startsWith(api + '/git/blobs/')) {
      const wanted = url.split('/').at(-1);
      const bytes = [...files.values()].find(value => sha(value) === wanted);
      assert(bytes, 'Only declared source blobs are requested.');
      state.count++;
      if (state.moveDuringDownload) state.head = headB;
      return json({ sha: wanted, size: bytes.length, encoding: 'base64', content: (state.mismatchBlob ? Buffer.from('corrupted bytes') : bytes).toString('base64') });
    }
    throw new Error('Unexpected fixture request.');
  };
  return { files, state, calls, asset, options: { env: { BLOGMACHINE_GITHUB_TOKEN: 'fixture-read-only-token' }, request, cacheDirectory } };
}

test('GitHub source materializes only the required verified source/cover subset and reuses immutable cached blobs', async t => {
  const f = await fixture(t);
  const root = await ensureGitHubSource('ocenagor', f.options);
  assert(isGitHubSourceRoot(root));
  assert.equal(await readFile(resolve(root, f.asset), 'utf8'), 'An image fixture\0with bytes');
  const manifest = JSON.parse(await readFile(resolve(root, '.blogmachine-source.json'), 'utf8'));
  assert.equal(manifest.repository, repository); assert.equal(manifest.head, headA); assert.equal(manifest.branch, 'main');
  assert.equal(manifest.files.length, 16);
  assert(!JSON.stringify(manifest).includes('fixture-read-only-token'));
  await assert.rejects(readFile(resolve(root, 'private/secrets.txt')));
  assert(!f.calls.some(call => call.url.endsWith(sha(f.files.get('private/secrets.txt')!))));
  const blobs = f.state.count;
  const refRequests = f.calls.filter(call => call.url.endsWith('/git/ref/heads/main')).length;
  assert.equal(await ensureGitHubSource('ocenagor', f.options), root);
  assert.equal(f.state.count, blobs, 'A fresh branch request does not redownload immutable source blobs.');
  assert(f.calls.filter(call => call.url.endsWith('/git/ref/heads/main')).length > refRequests);
  assert.deepEqual(await githubSourceIdentity(root), { head: headA, branch: 'main', sourceMode: 'github' });
});

test('GitHub source requires a server read token and accepts only the fixed repository connection', async t => {
  const f = await fixture(t);
  await assert.rejects(ensureGitHubSource('ocenagor', { ...f.options, env: {} }), hasCode('token_missing'));
  await assert.rejects(ensureGitHubSource('../another-repository', f.options), hasCode('source_invalid'));
  assert.equal(f.calls.length, 0);
  await ensureGitHubSource('ocenagor', { ...f.options, env: { GITHUB_TOKEN: 'fixture-fallback-token' } });
  assert.equal(new Headers(f.calls[0].init?.headers).get('Authorization'), 'Bearer fixture-fallback-token');
});

test('GitHub source prefers its scoped token over the generic token', async t => {
  const f = await fixture(t);
  await ensureGitHubSource('ocenagor', { ...f.options, env: { BLOGMACHINE_GITHUB_TOKEN: 'fixture-scoped-token', GITHUB_TOKEN: 'fixture-generic-token' } });
  assert.equal(new Headers(f.calls[0].init?.headers).get('Authorization'), 'Bearer fixture-scoped-token');
});

test('GitHub identity refuses a stale main HEAD and subsequent loading fetches the new immutable snapshot', async t => {
  const f = await fixture(t);
  const first = await ensureGitHubSource('ocenagor', f.options);
  f.state.head = headB;
  await assert.rejects(githubSourceIdentity(first), hasCode('source_changed'));
  const second = await ensureGitHubSource('ocenagor', f.options);
  assert.notEqual(first, second);
  assert.equal((await githubSourceIdentity(second))?.head, headB);
});

test('GitHub source refuses a branch that moved during source download', async t => {
  const f = await fixture(t); f.state.moveDuringDownload = true;
  await assert.rejects(ensureGitHubSource('ocenagor', f.options), hasCode('source_changed'));
});

test('GitHub source detects content corruption and symlink substitution in cached files', async t => {
  const f = await fixture(t);
  const root = await ensureGitHubSource('ocenagor', f.options);
  await writeFile(resolve(root, 'src/content/blog/sl.ts'), 'tampered');
  await assert.rejects(githubSourceIdentity(root), hasCode('cache_invalid'));
  await writeFile(resolve(root, 'src/content/blog/sl.ts'), f.files.get('src/content/blog/sl.ts')!);
  const external = resolve(f.options.cacheDirectory, 'outside.webp');
  await writeFile(external, f.files.get(f.asset)!);
  await rm(resolve(root, f.asset)); await symlink(external, resolve(root, f.asset));
  await assert.rejects(githubSourceIdentity(root), hasCode('cache_invalid'));
});

test('A copied source manifest cannot attest an arbitrary checkout or evade source identity', async t => {
  const f = await fixture(t);
  const root = await ensureGitHubSource('ocenagor', f.options);
  const forged = await mkdtemp(resolve(f.options.cacheDirectory, 'forged-'));
  await writeFile(resolve(forged, '.blogmachine-source.json'), await readFile(resolve(root, '.blogmachine-source.json')));
  const requests = f.calls.length;
  assert.equal(isGitHubSourceRoot(forged), false);
  assert.equal(await githubSourceIdentity(forged), null);
  assert.equal(f.calls.length, requests);
});

test('GitHub source rejects incomplete trees, wrong commits, oversized blobs and unsafe tree paths', async t => {
  for (const type of ['truncated', 'commit', 'large', 'large-total', 'many-files', 'symlink', 'traversal', 'missing', 'duplicate'] as const) {
    await t.test(type, async subtest => {
      const f = await fixture(subtest);
      if (type === 'truncated') f.state.treeTruncated = true;
      if (type === 'commit') f.state.mismatchCommit = true;
      if (type === 'large') f.state.treeMutator = entries => entries.map(file => file.path === paths[0] ? { ...file, size: 2 * 1024 * 1024 + 1 } : file);
      if (type === 'large-total') f.state.treeMutator = entries => entries.map(file => String(file.path).startsWith('src/') ? { ...file, size: 2 * 1024 * 1024 } : file);
      if (type === 'many-files') f.state.treeMutator = entries => [...entries, ...Array.from({ length: 181 }, (_, index) => ({ path: `src/content/blog/additional-${index}.ts`, mode: '100644', type: 'blob', sha: headA, size: 1 }))];
      if (type === 'symlink') f.state.treeMutator = entries => entries.map(file => file.path === paths[0] ? { ...file, mode: '120000' } : file);
      if (type === 'traversal') f.state.treeMutator = entries => [...entries, { path: '../escape.ts', mode: '100644', type: 'blob', sha: headA, size: 1 }];
      if (type === 'missing') f.files.delete(paths[0]);
      if (type === 'duplicate') f.state.treeMutator = entries => [...entries, entries[0]];
      await assert.rejects(ensureGitHubSource('ocenagor', f.options), hasCode('source_invalid'));
      assert.equal(f.state.count, 0, 'Invalid tree metadata is refused before any blob downloads.');
    });
  }
});

test('GitHub source validates Git blob hashes and refuses missing or escaping cover assets without evaluating source', async t => {
  for (const type of ['hash', 'missing-image', 'escaping-image', 'computed-images'] as const) {
    await t.test(type, async subtest => {
      const f = await fixture(subtest);
      if (type === 'hash') f.state.mismatchBlob = true;
      if (type === 'missing-image') f.files.delete(f.asset);
      if (type === 'escaping-image') f.files.set('src/content/blog/images.ts', Buffer.from('const BLOG_IMAGES={guide:{src:"/images/blog/../../escape.webp",small:"/images/blog/cover.webp",share:"/images/blog/cover.webp"}};'));
      if (type === 'computed-images') f.files.set('src/content/blog/images.ts', Buffer.from('const BLOG_IMAGES=(()=>{globalThis.__blogmachineSourceEvaluated=true;return {};})();'));
      await assert.rejects(ensureGitHubSource('ocenagor', f.options), hasCode('source_invalid'));
      assert.equal((globalThis as Record<string, unknown>).__blogmachineSourceEvaluated, undefined);
    });
  }
});

test('GitHub failures expose only sanitized typed messages', async t => {
  for (const status of [401, 403, 404, 429, 500]) {
    const f = await fixture(t); f.state.status = status;
    await assert.rejects(ensureGitHubSource('ocenagor', f.options), error => {
      assert(error instanceof GitHubSourceError);
      assert(!error.message.includes('private upstream detail'));
      assert(!error.message.includes('fixture-read-only-token'));
      return true;
    });
  }
});

test('Concurrent source loads share one immutable download without skipping fresh branch checks', async t => {
  const f = await fixture(t);
  const roots = await Promise.all(Array.from({ length: 4 }, () => ensureGitHubSource('ocenagor', f.options)));
  assert.equal(new Set(roots).size, 1);
  assert.equal(f.state.count, 16);
  assert(f.calls.filter(call => call.url.endsWith('/git/ref/heads/main')).length >= 4);
});

test('Reloading replaces a corrupt cached snapshot without trusting or repairing the old root in place', async t => {
  const f = await fixture(t);
  const original = await ensureGitHubSource('ocenagor', f.options);
  await rm(resolve(original, 'src/content/blog/sl.ts'));
  await assert.rejects(githubSourceIdentity(original), hasCode('cache_invalid'));
  const restored = await ensureGitHubSource('ocenagor', f.options);
  assert.notEqual(original, restored);
  assert.equal(await readFile(resolve(restored, 'src/content/blog/sl.ts'), 'utf8'), f.files.get('src/content/blog/sl.ts')!.toString('utf8'));
  assert.equal((await githubSourceIdentity(restored))?.head, headA);
  await assert.rejects(githubSourceIdentity(original), hasCode('cache_invalid'));
});

test('The source cache retains at most three commit snapshots and old roots fail closed', async t => {
  const f = await fixture(t);
  const roots: string[] = [];
  for (const head of ['1', '2', '3', '4']) {
    f.state.head = head.repeat(40);
    roots.push(await ensureGitHubSource('ocenagor', f.options));
  }
  await assert.rejects(readFile(resolve(roots[0], '.blogmachine-source.json')));
  for (const root of roots.slice(1)) assert(JSON.parse(await readFile(resolve(root, '.blogmachine-source.json'), 'utf8')).head);
  assert(isGitHubSourceRoot(roots[0]), 'A retired server-attested root remains recognizable to reject in-flight preparation.');
  await assert.rejects(githubSourceIdentity(roots[0]), hasCode('source_changed'));
  assert.equal((await githubSourceIdentity(roots[3]))?.head, '4'.repeat(40));
});


test('Concurrent reloads recover a corrupt commit once and leave no orphaned snapshot directories', async t => {
  const f = await fixture(t);
  const old = await ensureGitHubSource('ocenagor', f.options);
  await writeFile(resolve(old, 'src/content/blog/sl.ts'), 'corrupted');
  const downloaded = f.state.count;
  const roots = await Promise.all(Array.from({ length: 8 }, () => ensureGitHubSource('ocenagor', f.options)));
  assert.equal(new Set(roots).size, 1);
  assert.notEqual(roots[0], old);
  assert.equal(f.state.count - downloaded, 16, 'Recovery performs exactly one replacement download.');
  assert.equal((await readdir(f.options.cacheDirectory)).length, 1, 'The corrupt directory is removed and no replacement directory is orphaned.');
  assert.equal((await githubSourceIdentity(roots[0]))?.head, headA);
});


test('Venue image registry assets are fetched, SHA-verified, and attested with localized alt text left as data', async t => {
  const f = await fixture(t);
  const venueAsset = 'public/images/blog/venue.webp';
  f.files.set(venueAsset, Buffer.from('Venue cover fixture'));
  f.files.set('src/content/blog/images.ts', Buffer.concat([f.files.get('src/content/blog/images.ts')!, Buffer.from('const VENUE_IMAGES={venue:{src:"/images/blog/venue.webp",small:"/images/blog/venue.webp",share:"/images/blog/venue.webp",alt:{sl:"Prizor",hr:"Prizor",it:"Scena"}}}; const VENUE_COVER_SOURCE={guide:"venue"};')]));
  const root = await ensureGitHubSource('ocenagor', f.options);
  assert.equal(await readFile(resolve(root, venueAsset), 'utf8'), 'Venue cover fixture');
  const manifest = JSON.parse(await readFile(resolve(root, '.blogmachine-source.json'), 'utf8'));
  assert.equal(manifest.files.find((file: { path: string }) => file.path === venueAsset)?.sha, sha(f.files.get(venueAsset)!));
  assert(f.calls.some(call => call.url.endsWith(`/git/blobs/${sha(f.files.get(venueAsset)!)}`)));
  await writeFile(resolve(root, venueAsset), 'A substituted venue image');
  await assert.rejects(githubSourceIdentity(root), hasCode('cache_invalid'));
});

test('A declared venue image registry must remain literal, unique, and inside the approved asset directory', async t => {
  for (const declaration of [
    'const VENUE_IMAGES=(()=>{globalThis.__blogmachineVenueEvaluated=true;return {};})();',
    'const VENUE_IMAGES=null;',
    'const VENUE_IMAGES={venue:{src:"/images/blog/cover.webp"}};',
    'const VENUE_IMAGES={venue:{src:"/images/blog/../escape.webp",small:"/images/blog/cover.webp",share:"/images/blog/cover.webp"}};',
    'const VENUE_IMAGES={}; const VENUE_IMAGES={};',
  ]) {
    const f = await fixture(t);
    f.files.set('src/content/blog/images.ts', Buffer.concat([f.files.get('src/content/blog/images.ts')!, Buffer.from(declaration)]));
    await assert.rejects(ensureGitHubSource('ocenagor', f.options), hasCode('source_invalid'));
    assert.equal((globalThis as Record<string, unknown>).__blogmachineVenueEvaluated, undefined);
  }
});
