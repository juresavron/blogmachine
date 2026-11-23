import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createD1Store } from './store.js';
import { configureHostedSessions, createMediaspedSessions, encryptSession, decryptSession, mediaspedSessionError } from './sessions.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('drizzle/0000_closed_lord_tyger.sql','utf8'));
  function prepare(text: string, args: unknown[] = []): any {
    const execute = () => sql.prepare(text).all(...args as any[]);
    return { bind: (...values: unknown[]) => prepare(text, values), first: async () => execute()[0] ?? null, all: async () => ({results:execute(),success:true,meta:{}}), run: async () => { const results=execute(); return {results,success:true,meta:{changes:sql.prepare('SELECT changes() n').get()!.n}}; }, _execute: execute };
  }
  const db = { prepare, batch: async (statements:any[]) => { sql.exec('BEGIN');try { const result=statements.map(s=>({results:s._execute(),success:true,meta:{}}));sql.exec('COMMIT');return result; }catch(e){sql.exec('ROLLBACK');throw e;} } } as unknown as D1Database;
  return {db,sql};
}
const key = Buffer.alloc(32, 7).toString('base64');
test('hosted connector tokens are encrypted and bound to one session', async () => {
  const session={clientId:'browser',accessToken:'private-access',refreshToken:'private-refresh',tokenExpiresAt:123,expiresAt:456};
  const encrypted=await encryptSession(session,key,'one');
  assert.equal(encrypted.includes(session.accessToken),false);
  assert.deepEqual(await decryptSession(encrypted,key,'one'),session);
  await assert.rejects(decryptSession(encrypted,key,'two'));
  await assert.rejects(decryptSession(encrypted,Buffer.alloc(32,8).toString('base64'),'one'));
  const bytes=Buffer.from(encrypted,'base64');bytes[20]^=1;
  await assert.rejects(decryptSession(bytes.toString('base64'),key,'one'));
});
test('D1 drafts survive a new store instance and related deletion commits atomically', async () => {
  const {db,sql}=database(); const first=createD1Store(db);
  const site={id:'site',name:'Example',url:'https://example.com',platform:'demo' as const,searchConsoleProperty:'',credentialKey:'EXAMPLE',createdAt:'now'};
  const post={id:'post',title:'A draft',slug:'a-draft',excerpt:'Description',content:'Text',siteIds:['site','other'],status:'published' as const,createdAt:'now',updatedAt:'now'};
  await first.putSite(site);await first.putPost(post);
  await first.putPublication({id:'pub',postId:'post',siteId:'site',url:'https://example.com/a-draft',status:'published',mode:'demo',error:null,publishedAt:'now',indexingStatus:'not_inspected',lastInspectedAt:null});
  const second=createD1Store(db);assert.deepEqual(await second.post('post'),post);
  await second.putChange({id:'change',artifact:'patch'} as any);assert.equal((await first.change('change')).artifact,'patch');
  await second.deleteSite('site');assert.equal(await first.site('site'),undefined);assert.deepEqual((await first.post('post'))!.siteIds,['other']);assert.equal((await first.post('post'))!.status,'draft');assert.deepEqual(await first.publications(),[]);
  await first.deletePost('post');assert.deepEqual(await first.posts(),[]);sql.close();
});
test('hosted sessions survive app replacement, refresh once, revoke on logout, and reject non-admins', async t => {
  const {db,sql}=database();let clock=1_000_000;let admin=true;let refreshes=0;
  const user='91833161-d600-4a3d-b6b0-c72f6352fb1b';const token=(name:string)=>`fixture.${Buffer.from(JSON.stringify({sub:user,role:'authenticated',name})).toString('base64url')}.signature`;
  const request:typeof fetch=async (input,init)=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/token'){if(url.searchParams.get('grant_type')==='refresh_token')refreshes++;return Response.json({access_token:token(refreshes?'rotated':'first'),refresh_token:'private-refresh',expires_in:3600});}
    if(url.pathname==='/auth/v1/user')return Response.json({id:user});
    if(url.pathname==='/rest/v1/rpc/is_admin')return Response.json(admin);
    if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204});
    throw new Error('Unexpected provider request');
  };
  const options={workspace:'/tmp/missing',env:{MEDIASPED_SUPABASE_URL:'https://ytmowbzkpofeeocgevyr.supabase.co',MEDIASPED_SUPABASE_ANON_KEY:'public-key'},request,now:()=>clock};
  const servers:any[]=[];
  async function start(){configureHostedSessions(db,key);const app=express();app.use(express.json());app.use(createMediaspedSessions(options).router);app.use((e:unknown,_req:any,res:any,_next:any)=>{const error=mediaspedSessionError(e);res.status(error?.status??500).json({error:error?.message??'error'});});const server=await new Promise<any>(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});servers.push(server);return `http://127.0.0.1:${server.address().port}`;}
  t.after(async()=>{for(const s of servers)await new Promise<void>(r=>s.close(()=>r()));sql.close();});
  let base=await start();let jar='';
  async function api(path:string,method='GET',body?:unknown){const response=await fetch(base+'/connections/mediasped/'+path,{method,headers:{Cookie:jar,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const cookies=new Map(jar.split('; ').filter(Boolean).map(s=>s.split('=') as [string,string]));for(const value of response.headers.getSetCookie()){const [name,valuePart]=value.split(';')[0].split('=');cookies.set(name,valuePart);assert.match(value,/HttpOnly/);assert.match(value,/Secure/);}jar=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');return {status:response.status,data:await response.json()};}
  assert.equal((await api('session')).data.authenticated,false);
  assert.equal((await api('login','POST',{email:'admin@example.com',password:'private-password'})).data.authenticated,true);
  const persisted=JSON.stringify(sql.prepare('SELECT * FROM connector_sessions').all());assert.equal(persisted.includes('private-refresh'),false);assert.equal(persisted.includes('private-password'),false);assert.equal(persisted.includes(token('first')),false);
  base=await start();assert.equal((await api('session')).data.authenticated,true);
  clock+=3_550_000;assert.equal((await api('session')).data.authenticated,true);assert.equal(refreshes,1);
  base=await start();assert.equal((await api('session')).data.authenticated,true);assert.equal(refreshes,1);
  admin=false;assert.equal((await api('session')).data.authenticated,false);admin=true;
  const oldJar=jar;await api('logout','POST');jar=oldJar;base=await start();assert.equal((await api('session')).data.authenticated,false);
});
