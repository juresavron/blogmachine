import { definition } from '../repositories/catalog.js';
import type { HostedRepositorySource } from '../repositories/files.js';

export function githubRepositorySource(credential: () => Promise<{token:string;version:string}> = async () => ({token:'',version:'public'})): HostedRepositorySource {
  const heads = new Map<string, { head: string; branch: string; until: number }>();
  const files = new Map<string, string>();
  const pending = new Map<string, Promise<{ head: string; branch: string; until: number }>>();
  async function identity(id: string, fresh: boolean) {
    const auth = await credential();
    const cacheKey = `${auth.version}:${id}`;
    const cached = heads.get(cacheKey);
    if (!fresh && cached && cached.until > Date.now()) return cached;
    if (pending.has(cacheKey)) return pending.get(cacheKey)!;
    const loading = (async () => {
      const item = definition(id);
      const response = await fetch(`https://api.github.com/repos/${item.repository}/commits?per_page=1`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BlogMachine', ...(auth.token ? {Authorization:`Bearer ${auth.token}`} : {}) }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Could not read the repository revision.');
      const result = await response.json() as { sha: string }[];
      const head = result[0]?.sha;
      if (!head || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid repository revision.');
      const value = { head, branch: 'default branch', until: Date.now() + 10 * 60_000 };
      heads.set(cacheKey, value); return value;
    })();
    pending.set(cacheKey, loading);
    try { return await loading; } finally { pending.delete(cacheKey); }
  }
  function location(path: string) {
    const match = /^\/repositories\/([a-z0-9-]+)\/([a-f0-9]{40})\/(.+)$/.exec(path);
    if (!match || match[3].split('/').some(s => !s || s === '.' || s === '..') || /[\\?#\x00]/.test(path)) throw new Error('Invalid repository file path.');
    return { id: match[1], head: match[2], path: match[3], url: `https://api.github.com/repos/${definition(match[1]).repository}/contents/${match[3].split('/').map(encodeURIComponent).join('/')}?ref=${match[2]}` };
  }
  return {
    async root(id, fresh = false) { const value = await identity(id, fresh); return `/repositories/${id}/${value.head}`; },
    async identity(root) { const match = /^\/repositories\/([a-z0-9-]+)\/([a-f0-9]{40})$/.exec(root); if (!match) throw new Error('Unknown repository snapshot.'); return { head: match[2], branch: 'default branch' }; },
    async read(path) {
      const source = location(path);
      const auth = await credential(), cacheKey = `${auth.version}:${path}`;
      if (files.has(cacheKey)) return files.get(cacheKey)!;
      const response = await fetch(source.url, { headers:{Accept:'application/vnd.github.raw+json','User-Agent':'BlogMachine',...(auth.token ? {Authorization:`Bearer ${auth.token}`} : {})},redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('The repository content file is unavailable.');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('Repository content exceeds the supported size.');
      if (files.size > 150) files.clear();
      files.set(cacheKey, text); return text;
    },
    async exists(path) { const { url } = location(path), auth=await credential(); return (await fetch(url, { headers:{Accept:'application/vnd.github.raw+json','User-Agent':'BlogMachine',...(auth.token ? {Authorization:`Bearer ${auth.token}`} : {})},method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15_000) })).ok; },
  };
}
