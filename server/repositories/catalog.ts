import { resolve } from 'node:path';
import { realpath, hostedRepositorySource } from './files.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logistiscworldAdapter } from './logistiscworld.js';
import { onlyworldAdapter } from './onlyworld.js';
import { luminaAdapter } from './lumina.js';
import { mediaspedTargets } from './mediasped.js';
import { ocenagorAdapter } from './ocenagor.js';
import { trgovinaTargets } from './trgovina.js';
import type { GitAdapter, RepoTarget } from './types.js';

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
    { id:'ocenagor',label:'OcenaGor.si',repository:'juresavron/ocenagor-landing-lovable-13',checkoutDirectory:'ocenagor-landing-lovable-13',description:'Slovenian guides for websites, Google reviews, NFC, and reservations.',kind:'git-content',targets:ocenagorAdapter.targets,warnings:['Slovenian source content only. Croatian and Italian editions have separate translation structures and are not generated automatically.','New posts require an approved image mapping; the prepared patch includes both article and image registry changes.','A prepared Git patch is not a live publication.'],deployment:'Review both article and image changes, run the website gates, and merge into the confirmed Netlify production branch. Verify deployment and the public article URL before treating it as published.' },
    { id:'logistiscworld',label:'LogisticsWorld',repository:'juresavron/logistiscworld',description:'Shipping guides that bring enquiries to Mediašped.',kind:'git-content',targets:logistiscworldAdapter.targets,warnings:['This repository serves logisticsworld.eu, not mediasped.com.','The source sets noindex, nofollow globally. Indexing requires a reviewed launch change.','No automatic GitHub deployment is connected in the repository documentation.'],deployment:'Review the source change, run the site checks, and explicitly deploy the Cloudflare Worker.' },
    { id:'onlyworld',label:'Onlyworld',repository:'juresavron/onlyworld',description:'Local articles for each country and language.',kind:'git-content',targets:onlyworldAdapter.targets,warnings:['Each country needs its own relevant language and article. Preparing a change does not translate it.','Pushes to main trigger the repository deployment workflow. Do not push an unreviewed change.','ocenagor.si is not one of the configured country domains.'],deployment:'Review and merge into the confirmed deployment branch. The current workflow deploys pushes to main.' },
    { id:'lumina',label:'Lumina Pergole',repository:'juresavron/lumina',description:'Pergola prices, comparisons, and installation advice.',kind:'git-content',targets:luminaAdapter.targets,warnings:['The checked-out default branch is a development branch; the actual production branch is unverified.','This static website publishes every guide included in a build. Drafts must stay in Blog Machine.'],deployment:'Review the change and deploy the confirmed production branch through Netlify.' },
    { id:'trgovina',label:'Trgovina',repository:'juresavron/trgovina',description:'Product blog posts for the shops in your commerce platform.',kind:'database',targets:[...trgovinaTargets],warnings:['The posts connector handles /blog articles. Existing buying guides and comparison pages are separate source files.','The vrecke tenant is marked pre-launch. Production custom-domain routing is not verified by this checkout.','A signed-in Supabase admin token is required; no service-role credential is used.'],deployment:'Prepare a database draft payload, then create the draft through the authorized admin workflow. No database writes are performed here.' },
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
export async function checkedRepositoryRoot(workspace: string, id: string, fresh = false) {
  definition(id);
  if (hostedRepositorySource()) return hostedRepositorySource()!.root(id, fresh);
  const base = await realpath(workspace);
  const item = definition(id);
  const directory = item.checkoutDirectory ?? id;
  const root = await realpath(resolve(base, directory));
  if (root !== resolve(base, directory)) throw new Error('Repository symlinks are not supported for content preparation.');
  const remote = (await execute('git', ['-C', root, 'config', '--get', 'remote.origin.url'])).stdout.trim();
  const expected = `https://github.com/${item.repository}`;
  if (remote.replace(/\.git$/, '') !== expected) throw new Error('The checkout remote does not match this repository connection.');
  return root;
}
export async function gitIdentity(root: string) {
  if (hostedRepositorySource()) return hostedRepositorySource()!.identity(root);
  const [head, branch] = await Promise.all([
    execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']),
    execute('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ({stdout:'detached HEAD'})),
  ]);
  return { head: head.stdout.trim(), branch: branch.stdout.trim() };
}
