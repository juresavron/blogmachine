import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../app.js';
import { checkedRepositoryRoot } from './catalog.js';
import { GitHubSourceError } from './github-source.js';

const directory = 'ocenagor-landing-lovable-13';

test('hosted catalog reports source setup without trying GitHub when no token is configured', async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'blogmachine-source-catalog-'));
  const workspace = resolve(temp, 'absent-workspace');
  let calls = 0;
  const { app, store } = createApp({ databasePath: ':memory:', seed: false, env: {}, repositoriesWorkspace: workspace, repositoriesRequest: async () => { calls++; throw new Error('No outbound requests expected.'); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(temp, { recursive: true, force: true }); });
  const response = await fetch(`${base}/repositories`); assert.equal(response.status, 200);
  const data = await response.json();
  const family = data.repositories.find((item: {id: string}) => item.id === 'ocenagor');
  assert.equal(family.available, false); assert.equal(family.sourceMode, 'github'); assert.equal(family.sourceRequiresToken, true);
  assert.deepEqual(family.targets.map((target: {url: string}) => target.url), ['https://ocenagor.si', 'https://ocjenagor.hr', 'https://valutosu.it']);
  assert.match(family.message, /read-only Contents/);
  const articles = await fetch(`${base}/repositories/ocenagor/articles?target=hr`);
  assert.equal(articles.status, 428);
  assert.match((await articles.json()).error, /BLOGMACHINE_GITHUB_TOKEN/);
  assert.equal(calls, 0);
});

test('missing local source can use hosted mode, but an existing wrong-origin checkout cannot', async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'blogmachine-source-origin-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await assert.rejects(checkedRepositoryRoot(temp, 'ocenagor', { env: {} }), error => error instanceof GitHubSourceError && error.code === 'token_missing');
  const root = resolve(temp, directory); await mkdir(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { stdio: 'ignore' });
  git('init'); git('remote', 'add', 'origin', 'https://github.com/example/wrong-site.git');
  let calls = 0;
  await assert.rejects(checkedRepositoryRoot(temp, 'ocenagor', { env: { BLOGMACHINE_GITHUB_TOKEN: 'fixture-read-token' }, request: async () => { calls++; throw new Error('No fallback allowed.'); } }), /remote does not match/);
  assert.equal(calls, 0);
});

test('a symlinked local source is refused rather than bypassed with remote fallback', async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'blogmachine-source-symlink-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const workspace = resolve(temp, 'workspace'); const outside = resolve(temp, 'outside');
  await mkdir(workspace); await mkdir(outside); await writeFile(resolve(outside, 'marker'), 'untouched');
  await symlink(outside, resolve(workspace, directory));
  let calls = 0;
  await assert.rejects(checkedRepositoryRoot(workspace, 'ocenagor', { env: { BLOGMACHINE_GITHUB_TOKEN: 'fixture-read-token' }, request: async () => { calls++; throw new Error('No fallback allowed.'); } }), /symlinks are not supported/);
  assert.equal(calls, 0);
});
