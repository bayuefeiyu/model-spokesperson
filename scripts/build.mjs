import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const shared = ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'zod'];
await build({ entryPoints: ['src/host.ts'], outfile: 'packages/host/lib/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node24', external: shared, sourcemap: true });
await mkdir('packages/ui/lib', { recursive: true });
await writeFile('packages/ui/lib/index.js', 'export function apply() {}\n');
const name = '@dsh-plugins/model-spokesperson-ui';
await build({ entryPoints: ['src/client.ts'], outfile: 'packages/ui/lib/client.js', bundle: true, format: 'cjs', platform: 'browser', target: 'es2023', external: shared, sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
});
await mkdir('packages/bundle/lib', { recursive: true });
await writeFile('packages/bundle/lib/index.js', 'export {};\n');
console.log('Built Host ESM and Client module-loader bundle; all Host shared modules remain external.');
