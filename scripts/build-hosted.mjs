import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const generated = resolve('.hosted-build');
await mkdir(generated, { recursive: true });
const assets = {};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = `${dir}/${entry.name}`, relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'server') await collect(path, relative); }
    else assets[relative] = { body: (await readFile(path)).toString('base64'), type: types[extname(path)] ?? 'application/octet-stream' };
  }
}
await collect('dist');
await writeFile(`${generated}/assets.js`, `export default ${JSON.stringify(assets)};\n`);
await build({
  entryPoints: ['server/hosted/index.ts'], outfile: 'dist/server/index.js', bundle: true, platform: 'node', format: 'esm', target: 'es2023', minify: true,
  external: ['node:*','cloudflare:*'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const __filename = '/bundle/index.js'; const __dirname = '/bundle';" },
  plugins: [{ name: 'hosted-storage-and-sessions', setup(builder) {
    builder.onResolve({ filter: /^\.\/store\.js$/ }, args => args.importer.endsWith('/server/app.ts') ? { path: resolve('server/hosted/local-store.ts') } : undefined);
    builder.onResolve({ filter: /^\.\/mediasped-sessions\.js$/ }, () => ({ path: resolve('server/hosted/sessions.ts') }));
  } }],
});
await mkdir('dist/.openai', { recursive:true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/wrangler.json', JSON.stringify({ name:'blog-machine',main:'index.js',compatibility_date:'2026-11-23',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:'blog-machine',database_id:'local-blog-machine'}] },null,2));
console.log('Hosted Worker built with durable D1 storage and private access.');
