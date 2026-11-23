import { readFile, realpath } from './files.js';
import { resolve } from 'node:path';
import ts from 'typescript';
import { checkedRepositoryRoot } from './catalog.js';
import { readLiteralVariable } from './source.js';

// These values are publishable configuration already shipped by the website.
// Never return them through the browser API or store admin tokens in source.
export async function databaseEnvironment(id: string, workspace: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const result = { ...env };
  if (id !== 'mediasped' && id !== 'trgovina') return result;
  try {
    const root = await checkedRepositoryRoot(workspace, id);
    const relativePath = id === 'mediasped' ? 'src/integrations/supabase/client.ts' : 'wrangler.jsonc';
    const file = await realpath(resolve(root, relativePath));
    if (file !== resolve(root, relativePath)) return result;
    const text = await readFile(file, 'utf8');
    let url: unknown, key: unknown;
    if (id === 'mediasped') {
      url = readLiteralVariable(text, 'SUPABASE_URL');
      key = readLiteralVariable(text, 'SUPABASE_PUBLISHABLE_KEY');
    } else {
      const parsed = ts.parseConfigFileTextToJson(file, text);
      if (parsed.error) return result;
      url = parsed.config?.vars?.SUPABASE_URL;
      key = parsed.config?.vars?.SUPABASE_ANON_KEY;
    }
    const prefix = id === 'mediasped' ? 'MEDIASPED' : 'TRGOVINA';
    if (!result[`${prefix}_SUPABASE_URL`] && typeof url === 'string') result[`${prefix}_SUPABASE_URL`] = url;
    if (!result[`${prefix}_SUPABASE_ANON_KEY`] && typeof key === 'string') result[`${prefix}_SUPABASE_ANON_KEY`] = key;
  } catch { /* A missing checkout cannot grant database access. */ }
  return result;
}
