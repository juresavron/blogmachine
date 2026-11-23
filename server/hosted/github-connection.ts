import { z } from 'zod';

const API = 'https://api.github.com';
export function githubConnection(db: D1Database, secret: string) {
  async function key(usage: ('encrypt' | 'decrypt')[]) { return crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), 'AES-GCM', false, usage); }
  async function encrypt(value: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:new TextEncoder().encode('github') }, await key(['encrypt']), new TextEncoder().encode(value));
    return Buffer.concat([iv,Buffer.from(encrypted)]).toString('base64');
  }
  async function credential() {
    const row = await db.prepare("SELECT data FROM hosting_credentials WHERE id='github'").first<{data:string}>();
    if (!row) return { token:'', version:'public' };
    const saved = JSON.parse(row.data) as { encrypted:string; version:string };
    const bytes = Buffer.from(saved.encrypted,'base64');
    const decrypted = await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes.subarray(0,12), additionalData:new TextEncoder().encode('github') },await key(['decrypt']),bytes.subarray(12));
    return { token:new TextDecoder().decode(decrypted), version:saved.version };
  }
  async function handle(request: Request): Promise<Response> {
    const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
    try {
      if (request.method === 'GET') return Response.json({ hosted:true, configured:Boolean((await credential()).token) },{headers});
      if (request.method === 'DELETE') {
        await db.prepare("DELETE FROM hosting_credentials WHERE id='github'").run();
        return Response.json({ configured:false, message:'GitHub disconnected.' },{headers});
      }
      if (request.method !== 'POST') return new Response('Method not allowed',{status:405,headers});
      const input = z.object({ token:z.string().trim().min(20).max(512).regex(/^(github_pat_|ghp_)[a-zA-Z0-9_]+$/) }).strict().safeParse(await request.json());
      if (!input.success) return Response.json({error:'Enter a valid GitHub personal access token.'},{status:400,headers});
      const response = await fetch(`${API}/repos/juresavron/mediasped-landing-lovable-15/commits?per_page=1`,{headers:{Authorization:`Bearer ${input.data.token}`,Accept:'application/vnd.github+json','User-Agent':'BlogMachine'},redirect:'manual',signal:AbortSignal.timeout(15_000)});
      if (!response.ok) return Response.json({error:'This token could not read Mediašped. Give it read access to repository contents and try again.'},{status:403,headers});
      const commits = await response.json() as {sha?:string}[];
      if (!/^[a-f0-9]{40}$/.test(commits[0]?.sha ?? '')) throw new Error('Invalid provider response');
      await db.prepare("INSERT INTO hosting_credentials(id,data) VALUES ('github',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({encrypted:await encrypt(input.data.token),version:crypto.randomUUID()})).run();
      return Response.json({configured:true,message:'GitHub connected. Your repository connections have been refreshed.'},{headers});
    } catch { return Response.json({error:'Could not check the GitHub connection. Try again.'},{status:502,headers}); }
  }
  return {credential,handle};
}
