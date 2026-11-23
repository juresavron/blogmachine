import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { githubConnection } from './github-connection.js';
import { githubRepositorySource } from './repositories.js';

test('GitHub credentials are checked, encrypted, never returned, and disconnected durably', async () => {
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
  const db={prepare(text:string){const statement=sql.prepare(text);let args:any[]=[];const prepared={bind(...values:any[]){args=values;return prepared;},async first(){return statement.get(...args)??null;},async run(){statement.run(...args);return {success:true};}};return prepared;}} as unknown as D1Database;
  const token='github_pat_private_fixture_123456'; const secret=Buffer.alloc(32,6).toString('base64');
  const prior=globalThis.fetch;let accepted=true;let calls=0;
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.github.com/repos/juresavron/mediasped-landing-lovable-15/commits?per_page=1');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);assert.equal(init?.redirect,'manual');return accepted?Response.json([{sha:'a'.repeat(40)}]):Response.json({error:token},{status:403});};
  try{
    const connection=githubConnection(db,secret);
    const status=()=>connection.handle(new Request('https://example.com/api/hosting/github'));
    assert.equal((await (await status()).json()).configured,false);
    const invalid=await connection.handle(new Request('https://example.com/api/hosting/github',{method:'POST',body:JSON.stringify({token:'bad'})}));assert.equal(invalid.status,400);assert.equal(calls,0);
    const saved=await connection.handle(new Request('https://example.com/api/hosting/github',{method:'POST',body:JSON.stringify({token})}));assert.equal(saved.status,200);assert.equal((await saved.text()).includes(token),false);
    assert.equal(JSON.stringify(sql.prepare('SELECT * FROM hosting_credentials').all()).includes(token),false);
    const replacement=githubConnection(db,secret);assert.equal((await replacement.credential()).token,token);assert.equal((await (await status()).json()).configured,true);
    accepted=false;
    const rejected=await connection.handle(new Request('https://example.com/api/hosting/github',{method:'POST',body:JSON.stringify({token})}));assert.equal(rejected.status,403);assert.equal((await rejected.text()).includes(token),false);
    assert.equal((await replacement.credential()).token,token);
    const disconnected=await replacement.handle(new Request('https://example.com/api/hosting/github',{method:'DELETE'}));assert.equal(disconnected.status,200);assert.equal((await connection.credential()).token,'');
  }finally{globalThis.fetch=prior;sql.close();}
});

test('hosted repository reads use the selected credential and exact revision, then discard caches after disconnect', async()=>{
  const prior=globalThis.fetch;let auth={token:'github_pat_fixture_private',version:'connected'};let files=0;let head='a'.repeat(40);
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('Authorization'),auth.token?'Bearer '+auth.token:null);
    if(url.pathname.endsWith('/commits'))return Response.json([{sha:head}]);
    assert.equal(url.searchParams.get('ref'),'a'.repeat(40));assert.equal(url.pathname,'/repos/juresavron/mediasped-landing-lovable-15/contents/src/example.ts');files++;
    return auth.token?new Response('export const posts = [];'):new Response('Denied',{status:404});
  };
  try{
    const source=githubRepositorySource(async()=>auth);const root=await source.root('mediasped');assert.equal((await source.identity(root)).head,head);
    assert.equal(await source.read(root+'/src/example.ts'),'export const posts = [];');await source.read(root+'/src/example.ts');assert.equal(files,1);
    head='b'.repeat(40);assert.notEqual(await source.root('mediasped',true),root);
    auth={token:'',version:'public'};await assert.rejects(source.read(root+'/src/example.ts'));assert.equal(files,2);
    await assert.rejects(source.read('/repositories/mediasped/'+'a'.repeat(40)+'/../secret'));
  }finally{globalThis.fetch=prior;}
});
