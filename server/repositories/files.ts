import * as fs from 'node:fs/promises';

export interface HostedRepositorySource {
  root(id: string, fresh?: boolean): Promise<string>;
  identity(root: string): Promise<{ head: string; branch: string }>;
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}
let hosted: HostedRepositorySource | undefined;
export function useHostedRepositorySource(source: HostedRepositorySource) { hosted = source; }
export function hostedRepositorySource() { return hosted; }
export async function readFile(path: string, _encoding: 'utf8'): Promise<string> {
  return hosted && path.startsWith('/repositories/') ? hosted.read(path) : fs.readFile(path, 'utf8');
}
export async function realpath(path: string): Promise<string> {
  if (hosted && path.startsWith('/repositories/')) return path;
  return fs.realpath(path);
}
export async function stat(path: string) {
  if (hosted && path.startsWith('/repositories/')) {
    if (!await hosted.exists(path)) throw new Error('Source file unavailable.');
    return { isFile: () => true };
  }
  return fs.stat(path);
}
