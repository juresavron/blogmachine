import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ContentStore } from '../storage.js';
import { checkedRepositoryRoot, definition, gitAdapters } from './catalog.js';
import { assertMediaspedSourceSlugAvailable } from './media-source.js';
import { registerImportedIdentity } from './snapshot-identity.js';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const snapshotSchema = z.object({
  version: z.literal(1), repository: z.string().max(200), head: sha,
  branch: z.string().min(1).max(200).regex(/^[a-zA-Z0-9/._-]+$/),
  files: z.array(z.object({ path: z.string().max(300), sha, content: z.string().max(2_000_000) }).strict()).min(1).max(40),
  assets: z.array(z.object({ path: z.string().max(300), sha, size: z.number().int().positive().max(100_000_000) }).strict()).max(2000).default([]),
}).strict();
export type SourceSnapshot = z.infer<typeof snapshotSchema>;
export type RepositorySource = SourceSnapshot & { id: string; importedAt: string };
export const gitBlobHash = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');

export function sourcePaths(id: string): string[] {
  const item = definition(id);
  if (item.kind === 'empty') throw new Error('This website has no content adapter yet.');
  if (id === 'mediasped') return ['src/integrations/supabase/client.ts', 'src/data/logisticsGuides.ts', 'src/data/logisticsGuideSummaries.ts'];
  if (id === 'trgovina') return ['wrangler.jsonc'];
  return [...new Set(item.targets.flatMap(target => [target.contentPath, ...(target.additionalPaths ?? [])]).concat(id === 'onlyworld' ? ['src/tenants/cities.ts'] : []))];
}
export function validateSourceSnapshot(id: string, input: unknown): SourceSnapshot {
  const expected = sourcePaths(id);
  const source = snapshotSchema.parse(input);
  if (source.repository !== definition(id).repository) throw new Error('This source snapshot belongs to another website.');
  if (source.files.length !== expected.length || new Set(source.files.map(file => file.path)).size !== expected.length || source.files.some(file => !expected.includes(file.path))) throw new Error('Include exactly the content files required by this website adapter.');
  for (const file of source.files) if (gitBlobHash(file.content) !== file.sha) throw new Error('A content file failed its Git integrity check. Export a fresh snapshot.');
  if (new Set(source.assets.map(asset => asset.path)).size !== source.assets.length) throw new Error('Duplicate asset paths are not supported.');
  for (const asset of source.assets) {
    if (id !== 'ocenagor' || !/^public\/images\/blog\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(asset.path) || asset.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Only existing Ocenagor blog image metadata belongs in this source snapshot.');
  }
  return source;
}

export function createRepositorySources(store: ContentStore, workspace: string) {
  const roots = new Map<string, Promise<string>>();
  async function materialize(source: RepositorySource) {
    const fingerprint = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    let root = roots.get(fingerprint);
    if (!root) {
      root = (async () => {
        const directory = await realpath(await mkdtemp(join(tmpdir(), 'blogmachine-source-')));
        for (const file of source.files) {
          const destination = join(directory, file.path);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, file.content, { mode: 0o600 });
        }
        registerImportedIdentity(directory, source);
        return directory;
      })();
      roots.set(fingerprint, root);
      root.catch(() => roots.delete(fingerprint));
    }
    return root;
  }
  return {
    async root(id: string) {
      try { return await checkedRepositoryRoot(workspace, id); }
      catch {
        const stored = await store.repositorySource?.(id);
        if (!stored) throw new Error('Website source is unavailable. Import its source snapshot or restore its checkout.');
        const checked = validateSourceSnapshot(id, { version: stored.version, repository: stored.repository, head: stored.head, branch: stored.branch, files: stored.files, assets: stored.assets });
        return materialize({ ...checked, id, importedAt: stored.importedAt });
      }
    },
    async import(id: string, input: unknown) {
      if (!store.putRepositorySource) throw new Error('This workspace does not support saved website sources.');
      const source = { ...validateSourceSnapshot(id, input), id, importedAt: new Date().toISOString() };
      const root = await materialize(source);
      // Parse source literals without executing website code, before persisting.
      if (gitAdapters[id]) for (const target of definition(id).targets) await gitAdapters[id].list(root, target.key);
      if (id === 'mediasped') await assertMediaspedSourceSlugAvailable(root, '');
      await store.putRepositorySource(source);
      return source;
    },
  };
}
