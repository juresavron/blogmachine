import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { checkedRepositoryRoot, definition, gitIdentity } from '../server/repositories/catalog.js';
import { sourcePaths, validateSourceSnapshot } from '../server/repositories/snapshots.js';
const execute = promisify(execFile);
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const id = argument('--id');
if (!id) throw new Error('Supply --id and optionally --workspace and --output.');
const root = await checkedRepositoryRoot(argument('--workspace') ?? '/workspace', id);
const identity = await gitIdentity(root);
const files = await Promise.all(sourcePaths(id).map(async path => {
  const content = (await execute('git', ['-C', root, 'show', `${identity.head}:${path}`], { maxBuffer: 3_000_000 })).stdout;
  const sha = (await execute('git', ['-C', root, 'rev-parse', `${identity.head}:${path}`])).stdout.trim();
  return { path, sha, content };
}));
const assets = id === 'ocenagor' ? (await execute('git', ['-C', root, 'ls-tree', '-r', '-l', identity.head, '--', 'public/images/blog'], { maxBuffer: 1_000_000 })).stdout.trim().split('\n').filter(Boolean).map(line => {
  const match = line.match(/^100644 blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/);
  if (!match) throw new Error('Blog image metadata must describe regular Git files.');
  return { sha: match[1], size: Number(match[2]), path: match[3] };
}).filter(asset => asset.size > 0) : [];
const source = validateSourceSnapshot(id, { version: 1, repository: definition(id).repository, ...identity, files, assets });
const output = resolve(argument('--output') ?? `source-snapshots/${id}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(source), { mode: 0o600 });
console.log(`Exported ${id} at ${identity.head.slice(0, 8)} to ${output}`);
