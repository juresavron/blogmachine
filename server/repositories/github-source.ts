import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { readLiteralVariable } from './source.js';
import ts from 'typescript';

const repository = 'juresavron/ocenagor-landing-lovable-13';
const branch = 'main';
const api = `https://api.github.com/repos/${repository}`;
const manifestName = '.blogmachine-source.json';
const maximumBlobBytes = 2 * 1024 * 1024;
const maximumSnapshotBytes = 16 * 1024 * 1024;
const maximumTreeBytes = 8 * 1024 * 1024;
const maximumFiles = 180;
const maximumCachedSnapshots = 3;
const shaPattern = /^[a-f0-9]{40}$/;
const requiredPaths = [
  'src/content/blog/sl.ts', 'src/content/blog/images.ts', 'src/content/blog/localization.ts', 'src/content/blog/index.ts',
  'src/content/blog/hr.ts', 'src/content/blog/hr-products.ts', 'src/content/blog/hr-booking.ts',
  'src/content/blog/it.ts', 'src/content/blog/it-products.ts', 'src/content/blog/it-booking.ts',
  'src/tenants/si.ts', 'src/tenants/hr.ts', 'src/tenants/it.ts', 'src/tenants/index.ts', 'src/tenants/types.ts',
];

export type GitHubSourceErrorCode = 'token_missing' | 'forbidden' | 'not_found' | 'rate_limited' | 'source_changed' | 'source_invalid' | 'upstream_unavailable' | 'cache_invalid';
export class GitHubSourceError extends Error {
  constructor(public readonly code: GitHubSourceErrorCode, message: string) { super(message); this.name = 'GitHubSourceError'; }
}
export interface GitHubSourceOptions {
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  cacheDirectory?: string;
}
export interface GitHubSourceManifest {
  version: 1;
  repository: typeof repository;
  branch: typeof branch;
  head: string;
  files: { path: string; sha: string; size: number }[];
}
interface TreeFile { path: string; sha: string; size: number; mode: string; type: string; }
interface Snapshot { root: string; manifest: GitHubSourceManifest; options: GitHubSourceOptions; manifestText: string; }
const snapshots = new Map<string, Snapshot>();
const attestedRoots = new Map<string, Snapshot>();
const downloads = new Map<string, Promise<Snapshot>>();
const retiredRoots = new Map<string, 'source_changed' | 'cache_invalid'>();

const invalidSource = () => new GitHubSourceError('source_invalid', 'The GitHub source did not match the supported repository file contract. No content was prepared.');
const invalidCache = () => new GitHubSourceError('cache_invalid', 'The cached repository source changed or is unavailable. Reload the repository connection before preparing content.');
const sourceChanged = () => new GitHubSourceError('source_changed', 'The repository changed on GitHub. Reload its articles before preparing content.');
function token(options: GitHubSourceOptions): string {
  const env = options.env ?? process.env;
  const value = env.BLOGMACHINE_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (!value) throw new GitHubSourceError('token_missing', 'Set BLOGMACHINE_GITHUB_TOKEN on the server with read-only Contents access to the OcenaGor repository to enable hosted source access.');
  return value;
}
function safePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 && !path.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
function sourcePath(path: string): boolean {
  return /^src\/content\/blog\/[a-z][a-z0-9-]*\.ts$/.test(path) || /^src\/tenants\/(si|hr|it|index|types)\.ts$/.test(path);
}
function imagePath(path: unknown): path is string {
  return safePath(path) && /^public\/images\/blog\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(webp|jpg|jpeg|png|avif|gif)$/.test(path);
}
function blobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}
async function jsonRequest(path: string, options: GitHubSourceOptions, limit = maximumTreeBytes): Promise<unknown> {
  let response: Response;
  try {
    response = await (options.request ?? fetch)(`${api}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token(options)}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'BlogMachine-read-only-source', 'Cache-Control': 'no-cache' } });
  } catch (error) {
    if (error instanceof GitHubSourceError) throw error;
    throw new GitHubSourceError('upstream_unavailable', 'GitHub source access is unavailable. Check the server network access and try again.');
  }
  if (!response.ok) {
    // Never forward upstream bodies or headers: they can contain private repository or credential details.
    if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') throw new GitHubSourceError('rate_limited', 'GitHub source requests are temporarily limited. Try again later.');
    if (response.status === 401 || response.status === 403) throw new GitHubSourceError('forbidden', 'GitHub source access was denied. Check the server token’s read-only repository access and network policy.');
    if (response.status === 404) throw new GitHubSourceError('not_found', 'The configured GitHub repository or branch is unavailable to this server. Check read-only repository access.');
    throw new GitHubSourceError('upstream_unavailable', 'GitHub could not return the repository source. Try again later.');
  }
  if (response.redirected) throw invalidSource();
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) throw invalidSource();
  const reader = response.body?.getReader();
  if (!reader) throw invalidSource();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw invalidSource(); }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch (error) {
    if (error instanceof GitHubSourceError) throw error;
    throw invalidSource();
  } finally { reader.releaseLock(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidSource();
  return value as Record<string, unknown>;
}
async function remoteHead(options: GitHubSourceOptions): Promise<string> {
  const ref = record(await jsonRequest('/git/ref/heads/main', options, 64 * 1024));
  const object = record(ref.object);
  if (ref.ref !== 'refs/heads/main' || object.type !== 'commit' || typeof object.sha !== 'string' || !shaPattern.test(object.sha)) throw invalidSource();
  return object.sha;
}
async function filesAtCommit(head: string, options: GitHubSourceOptions): Promise<TreeFile[]> {
  const commit = record(await jsonRequest(`/git/commits/${head}`, options, 256 * 1024));
  const treeId = record(commit.tree).sha;
  if (commit.sha !== head || typeof treeId !== 'string' || !shaPattern.test(treeId)) throw invalidSource();
  const tree = record(await jsonRequest(`/git/trees/${treeId}?recursive=1`, options));
  if (tree.sha !== treeId || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 30_000) throw invalidSource();
  const paths = new Set<string>();
  return tree.tree.map(value => {
    const file = record(value);
    if (!safePath(file.path) || paths.has(file.path)) throw invalidSource();
    if (typeof file.sha !== 'string' || typeof file.mode !== 'string' || typeof file.type !== 'string') throw invalidSource();
    paths.add(file.path);
    return { path: file.path, sha: file.sha, size: typeof file.size === 'number' ? file.size : NaN, mode: file.mode, type: file.type };
  });
}
function validateFiles(files: TreeFile[]): void {
  if (files.length > maximumFiles || files.reduce((sum, file) => sum + file.size, 0) > maximumSnapshotBytes) throw invalidSource();
  for (const file of files) {
    if (file.type !== 'blob' || file.mode !== '100644' || !shaPattern.test(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximumBlobBytes) throw invalidSource();
  }
}
async function downloadBlob(file: TreeFile, options: GitHubSourceOptions): Promise<Buffer> {
  const result = record(await jsonRequest(`/git/blobs/${file.sha}`, options, maximumBlobBytes * 2));
  if (result.sha !== file.sha || result.size !== file.size || result.encoding !== 'base64' || typeof result.content !== 'string') throw invalidSource();
  const encoded = result.content.replaceAll('\n', '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalidSource();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength !== file.size || bytes.toString('base64') !== encoded || blobSha(bytes) !== file.sha) throw invalidSource();
  if (sourcePath(file.path)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw invalidSource(); }
  }
  return bytes;
}
async function concurrent<T>(values: T[], work: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, values.length) }, async () => {
    while (next < values.length) { const value = values[next++]; await work(value); }
  }));
}
async function attest(snapshot: Snapshot): Promise<void> {
  try {
    if (await realpath(snapshot.root) !== snapshot.root) throw invalidCache();
    const marker = resolve(snapshot.root, manifestName);
    if (!(await lstat(marker)).isFile() || await realpath(marker) !== marker || await readFile(marker, 'utf8') !== snapshot.manifestText) throw invalidCache();
    await concurrent(snapshot.manifest.files, async file => {
      const path = resolve(snapshot.root, file.path);
      const info = await lstat(path);
      if (!info.isFile() || info.size !== file.size || await realpath(path) !== path || blobSha(await readFile(path)) !== file.sha) throw invalidCache();
    });
  } catch { throw invalidCache(); }
}
function imageRegistries(source: string): Record<string, unknown>[] {
  try {
    const registries = [record(readLiteralVariable(source, 'BLOG_IMAGES'))];
    const file = ts.createSourceFile('images.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const venueDeclarations = file.statements.flatMap(statement => ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'VENUE_IMAGES')
      : []);
    if (venueDeclarations.length > 1) throw invalidSource();
    if (venueDeclarations.length === 1) registries.push(record(readLiteralVariable(source, 'VENUE_IMAGES')));
    return registries;
  } catch { throw invalidSource(); }
}

async function materialize(head: string, options: GitHubSourceOptions, base: string): Promise<Snapshot> {
  const tree = await filesAtCommit(head, options);
  const sources = tree.filter(file => sourcePath(file.path));
  if (requiredPaths.some(path => !sources.some(file => file.path === path))) throw invalidSource();
  validateFiles(sources);
  const contents = new Map<string, Buffer>();
  await concurrent(sources, async file => { contents.set(file.path, await downloadBlob(file, options)); });
  const registries = imageRegistries(contents.get('src/content/blog/images.ts')!.toString('utf8'));
  const assets = new Set<string>();
  for (const image of registries.flatMap(registry => Object.values(registry))) {
    const fields = record(image);
    for (const key of ['src', 'small', 'share']) {
      const value = fields[key];
      if (typeof value !== 'string' || !value.startsWith('/images/blog/') || !imagePath(`public${value}`)) throw invalidSource();
      assets.add(`public${value}`);
    }
  }
  const selectedImages = tree.filter(file => assets.has(file.path));
  if (selectedImages.length !== assets.size) throw invalidSource();
  const selected = [...sources, ...selectedImages].sort((a, b) => a.path.localeCompare(b.path));
  validateFiles(selected);
  await concurrent(selectedImages, async file => { contents.set(file.path, await downloadBlob(file, options)); });
  await mkdir(base, { recursive: true, mode: 0o700 });
  if (await realpath(base) !== base) throw invalidCache();
  const root = await mkdtemp(resolve(base, `ocenagor-${head}-`));
  try {
    for (const file of selected) {
      const path = resolve(root, file.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, contents.get(file.path)!, { flag: 'wx', mode: 0o600 });
    }
    const manifest: GitHubSourceManifest = { version: 1, repository, branch, head, files: selected.map(({ path, sha, size }) => ({ path, sha, size })) };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(resolve(root, manifestName), manifestText, { flag: 'wx', mode: 0o600 });
    const snapshot: Snapshot = { root, manifest, manifestText, options };
    await attest(snapshot);
    if (await remoteHead(options) !== head) throw sourceChanged();
    return snapshot;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

async function retireSnapshot(key: string, snapshot: Snapshot, code: 'source_changed' | 'cache_invalid'): Promise<void> {
  if (snapshots.get(key) === snapshot) snapshots.delete(key);
  attestedRoots.delete(snapshot.root);
  retiredRoots.set(snapshot.root, code);
  // Keep a small tombstone list so in-flight users of retired roots fail closed without trying Git.
  while (retiredRoots.size > 32) retiredRoots.delete(retiredRoots.keys().next().value!);
  await rm(snapshot.root, { recursive: true, force: true });
}
async function pruneSnapshots(base: string, keep: Snapshot): Promise<void> {
  const entries = [...snapshots].filter(([key]) => key.startsWith(`${base}\0`));
  let count = entries.length;
  for (const [key, snapshot] of entries) {
    if (count <= maximumCachedSnapshots) break;
    if (snapshot === keep) continue;
    await retireSnapshot(key, snapshot, 'source_changed');
    count--;
  }
}

/** Fetch an allowlisted, immutable source subset without Git or executing repository code. */
export async function ensureGitHubSource(id: string, options: GitHubSourceOptions = {}): Promise<string> {
  if (id !== 'ocenagor') throw new GitHubSourceError('source_invalid', 'Hosted source access is supported only for the configured OcenaGor repository.');
  const head = await remoteHead(options);
  const base = resolve(options.cacheDirectory ?? resolve(tmpdir(), 'blogmachine-github-sources'));
  const key = `${base}\0${repository}\0${head}`;
  // Serialize validation, retirement and download together. A delayed cache reader must
  // never overwrite a newer replacement for the same commit and orphan its private files.
  let pending = downloads.get(key);
  if (!pending) {
    pending = (async () => {
      const existing = snapshots.get(key);
      if (existing) {
        try {
          await attest(existing);
          snapshots.delete(key); snapshots.set(key, existing);
          return existing;
        } catch (error) {
          if (!(error instanceof GitHubSourceError) || error.code !== 'cache_invalid') throw error;
          await retireSnapshot(key, existing, 'cache_invalid');
        }
      }
      const snapshot = await materialize(head, options, base);
      snapshots.set(key, snapshot); attestedRoots.set(snapshot.root, snapshot);
      await pruneSnapshots(base, snapshot);
      return snapshot;
    })();
    downloads.set(key, pending);
  }
  try {
    const snapshot = await pending;
    snapshot.options = options;
    return snapshot.root;
  } finally { if (downloads.get(key) === pending) downloads.delete(key); }
}

/** A disk marker is never sufficient to establish trusted remote-source identity. */
export function isGitHubSourceRoot(root: string): boolean { return attestedRoots.has(resolve(root)) || retiredRoots.has(resolve(root)); }

/** Verify current remote HEAD and cached bytes each time a caller checks source identity. */
export async function githubSourceIdentity(root: string): Promise<{ head: string; branch: 'main'; sourceMode: 'github' } | null> {
  const retired = retiredRoots.get(resolve(root));
  if (retired) throw retired === 'source_changed' ? sourceChanged() : invalidCache();
  const snapshot = attestedRoots.get(resolve(root));
  if (!snapshot) return null;
  if (await remoteHead(snapshot.options) !== snapshot.manifest.head) throw sourceChanged();
  await attest(snapshot);
  return { head: snapshot.manifest.head, branch, sourceMode: 'github' };
}
