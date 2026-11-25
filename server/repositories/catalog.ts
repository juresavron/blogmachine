import { importedIdentity } from './snapshot-identity.js';
import { resolve } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logistiscworldAdapter } from './logistiscworld.js';
import { onlyworldAdapter } from './onlyworld.js';
import { luminaAdapter } from './lumina.js';
import { mediaspedTargets } from './mediasped.js';
import { ocenagorAdapter } from './ocenagor.js';
import { venueTargets } from './ocenagor-venues.js';
import { trgovinaTargets } from './trgovina.js';
import type { GitAdapter, RepoTarget } from './types.js';
import { ensureGitHubSource, githubSourceIdentity, type GitHubSourceOptions } from './github-source.js';

const execute = promisify(execFile);
export interface RepositoryDefinition {
  id: string; label: string; repository: string; description: string; checkoutDirectory?: string;
  kind: 'git-content' | 'database' | 'empty';
  targets: RepoTarget[]; warnings: string[]; deployment: string;
}
export const gitAdapters: Record<string, GitAdapter> = {
  logistiscworld: logistiscworldAdapter, onlyworld: onlyworldAdapter, lumina: luminaAdapter, ocenagor: ocenagorAdapter,
};
export function definitions(): RepositoryDefinition[] {
  return [
    { id:'mediasped',label:'Mediašped',repository:'juresavron/mediasped-landing-lovable-15',checkoutDirectory:'mediasped-landing-lovable-15',description:'Your existing multilingual freight and shipping blog.',kind:'database',targets:mediaspedTargets,warnings:['The blog uses Supabase and an existing admin editor; no WordPress or per-site MCP is required.','Preparing a draft does not publish. Saving a website draft requires a connected administrator account.','Static logistics guide URLs take precedence; the connector rejects those reserved slugs.','Slugs are globally unique across languages in the existing database. Use distinct slugs for language versions.'],deployment:'Prepare and review the unpublished draft. With verified administrator access, save it to the website draft queue, then review and publish through the existing Mediašped editor.' },
    { id:'ocenagor',label:'OcenaGor · SI / HR / IT',repository:'juresavron/ocenagor-landing-lovable-13',checkoutDirectory:'ocenagor-landing-lovable-13',description:'One article family across OcenaGor.si, OcjenaGor.hr, and ValutoSu.it.',kind:'git-content',targets:ocenagorAdapter.targets,warnings:['Each destination uses its own language, URL slug, and SEO copy. Select the canonical Slovenian source to link Croatian and Italian versions.','A missing language version is not created by selecting a domain; prepare its reviewed target-language text.','Slovenian covers are shared through the source image registry. New article families include their localization registry changes.','Prepared patches require review and the selected market’s build and deployment. They are not live publications.'],deployment:'Review the source patch and run the website type, translation-key, and selected tenant build/SEO checks. Slovenian production uses Netlify. Croatian and Italian production use the selected market in the website’s manual Cloudflare deployment workflow. Verify the exact domain and article URL after release.' },
    { id:'logistiscworld',label:'LogisticsWorld',repository:'juresavron/logistiscworld',description:'Shipping guides that bring enquiries to Mediašped.',kind:'git-content',targets:logistiscworldAdapter.targets,warnings:['This repository serves logisticsworld.eu, not mediasped.com.','Public articles currently allow indexing. Verify each released URL and its metadata after deployment.','No automatic GitHub deployment is connected in the repository documentation.'],deployment:'Review the source change, run the site checks, and explicitly deploy the Cloudflare Worker.' },
    { id:'onlyworld',label:'Onlyworld',repository:'juresavron/onlyworld',description:'Local articles for each country and language.',kind:'git-content',targets:onlyworldAdapter.targets,warnings:['Each country needs its own relevant language and article. Preparing a change does not translate it.','Pushes to main trigger the repository deployment workflow. Do not push an unreviewed change.','ocenagor.si is not one of the configured country domains.'],deployment:'Review and merge into the confirmed deployment branch. The current workflow deploys pushes to main.' },
    { id:'lumina',label:'Lumina Pergole',repository:'juresavron/lumina',description:'Pergola prices, comparisons, and installation advice.',kind:'git-content',targets:luminaAdapter.targets,warnings:['The GitHub default branch is a development branch. Netlify production uses main; prepare production changes from that source revision.','This static website publishes every guide included in a build. Drafts must stay in Blog Machine.'],deployment:'Review the patch, run the website checks, and merge into main for the Netlify production build. Verify the public guide URL after deployment.' },
    { id:'trgovina',label:'Trgovina',repository:'juresavron/trgovina',description:'Product blog posts for the shops in your commerce platform.',kind:'database',targets:[...trgovinaTargets],warnings:['The posts connector handles /blog articles. Existing buying guides and comparison pages are separate source files.','The vrecke tenant is marked pre-launch. Production custom-domain routing is not verified by this checkout.','Connect your existing shop administrator account; no service-role credential is used.'],deployment:'Prepare a database draft payload, then create the draft through the authorized admin workflow. Saving a website draft is a separate action after administrator verification; it never publishes.' },
    { id:'ocenagor-venues',label:'OcenaGor customer websites',repository:'juresavron/simple-site-11a8fbdb',description:'Existing customer websites, including restaurants, bars, salons and other venues.',kind:'database',targets:venueTargets,warnings:['Published articles come from the existing tenant-scoped public API; this does not grant editor or publishing access.','A website without published blog articles returns an empty list. This is not proof of a live blog page.','Database drafts follow the existing tenant blog limits and remain unapproved. Save and publish them through the authorized customer blog editor.'],deployment:'Review the JSON draft and use the existing OcenaGor customer blog editor with an authorized company administrator or a verified superadmin session. Automatic publishing settings stay unchanged.' },
    { id:'pultaro',label:'Pultaro',repository:'juresavron/pultaro',description:'NFC products, restaurant table stands, and custom engraving.',kind:'empty',targets:[],warnings:['The GitHub repository has no commits. There is no website or blog endpoint to connect yet.'],deployment:'Build the website and its content storage before enabling publishing.' },
    { id:'agencijadelavci',label:'Agencija delavci',repository:'juresavron/agencijadelavci',description:'Recruitment and employer guides, if that remains its purpose.',kind:'empty',targets:[],warnings:['The repository has no commits. Website purpose and publishing support are not yet defined.'],deployment:'Confirm the website purpose and implement its blog first.' },
    { id:'klicnicenter',label:'Klicni center',repository:'juresavron/klicnicenter',description:'Sales and customer support articles for a future service website.',kind:'empty',targets:[],warnings:['The repository has no commits. It is not a connected public publishing destination.'],deployment:'Create the public website and blog before enabling this connection.' },
  ];
}
export function definition(id: string) {
  const found = definitions().find(item => item.id === id);
  if (!found) throw new Error('Unknown repository connection.');
  return found;
}
/** Only a genuinely absent checkout permits another source provider. */
export class RepositoryCheckoutUnavailableError extends Error {
  constructor() { super('Repository checkout is unavailable. Restore it before preparing content.'); this.name = 'RepositoryCheckoutUnavailableError'; }
}
export async function localRepositoryRoot(workspace: string, id: string): Promise<string> {
  const item = definition(id);
  let base: string;
  try { base = await realpath(workspace); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling workspace link is an invalid configured path, not an absent checkout.
    try {
      if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Repository symlinks are not supported for content preparation.');
    } catch (inspectionError) {
      if ((inspectionError as NodeJS.ErrnoException).code !== 'ENOENT') throw inspectionError;
    }
    throw new RepositoryCheckoutUnavailableError();
  }
  const directory = item.checkoutDirectory ?? id;
  const expectedRoot = resolve(base, directory);
  let info;
  try { info = await lstat(expectedRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RepositoryCheckoutUnavailableError();
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error('Repository symlinks are not supported for content preparation.');
  if (!info.isDirectory()) throw new Error('The repository checkout must be a directory.');
  const root = await realpath(expectedRoot);
  if (root !== expectedRoot) throw new Error('Repository symlinks are not supported for content preparation.');
  const remote = (await execute('git', ['-C', root, 'config', '--get', 'remote.origin.url'])).stdout.trim();
  const expected = `https://github.com/${item.repository}`;
  if (remote.replace(/\.git$/, '') !== expected) throw new Error('The checkout remote does not match this repository connection.');
  return root;
}
export async function checkedRepositoryRoot(workspace: string, id: string, options: GitHubSourceOptions = {}): Promise<string> {
  try { return await localRepositoryRoot(workspace, id); }
  catch (error) {
    if (!(error instanceof RepositoryCheckoutUnavailableError) || id !== 'ocenagor') throw error;
    return ensureGitHubSource(id, options);
  }
}
export async function gitIdentity(root: string) {
  const imported = importedIdentity(root);
  if (imported) return { head: imported.head, branch: imported.branch, sourceMode: 'snapshot' as const };
  const hosted = await githubSourceIdentity(root);
  if (hosted) return hosted;
  const [head, branch] = await Promise.all([
    execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']),
    execute('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ({stdout:'detached HEAD'})),
  ]);
  return { head: head.stdout.trim(), branch: branch.stdout.trim(), sourceMode: 'local' as const };
}
