export interface ImportedIdentity {
  head: string; branch: string; importedAt: string;
  assets: { path: string; sha: string; size: number }[];
}
// Only roots materialized from validated workspace storage are registered here.
const identities = new Map<string, ImportedIdentity>();
export function registerImportedIdentity(root: string, identity: ImportedIdentity) { identities.set(root, identity); }
export function importedIdentity(root: string) { return identities.get(root); }
