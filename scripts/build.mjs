import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const shared = ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'zod'];
await build({ entryPoints: ['src/host.ts'], outfile: 'packages/host/lib/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node24', external: shared, sourcemap: true });
await mkdir('packages/ui/lib', { recursive: true });
await writeFile('packages/ui/lib/index.js', 'export function apply() {}\n');
const name = '@dsh-plugins/model-spokesperson-ui';
await build({ entryPoints: ['src/client.ts'], outfile: 'packages/ui/lib/client.js', bundle: true, format: 'cjs', platform: 'browser', target: 'es2023', external: shared, sourcemap: true,
  // This public pure leaf has no runtime imports and is not in rc.3's Client
  // module table. Bundle it explicitly, keeping Cordis/SDK services shared.
  plugins: [{ name: 'remote-info-pure-leaf', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-typert-protocol\/remote-info$/ }, () => ({ path: fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-typert-protocol/remote-info')) }));
  } }],
  banner: { js: `/*! Includes @deepseek-ai/dsh-typert-protocol/remote-info (MIT), Copyright (c) 2026 DeepSeek. See THIRD_PARTY_NOTICES.txt. */\nwindow.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
});
await mkdir('lib', { recursive: true });
await writeFile('lib/index.js', 'export function apply() {}\n');
console.log('Built Host ESM and Client module-loader bundle; all Host shared modules remain external.');
