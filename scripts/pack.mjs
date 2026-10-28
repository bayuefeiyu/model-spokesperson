import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const staging = resolve(root, '.dev/package');
await mkdir(staging, { recursive: true });
await cp(resolve(root, 'packages/bundle'), staging, { recursive: true });
await cp(resolve(root, 'README.md'), resolve(staging, 'README.md'));
for (const part of ['host', 'ui']) {
  const directory = resolve(staging, 'node_modules/@dsh-plugins/model-spokesperson-' + part);
  await mkdir(directory, { recursive: true });
  await cp(resolve(root, 'packages/' + part), directory, { recursive: true });
}
// Enforce the exact runtime at the bundle and each independently loadable entry.
for (const directory of [staging, ...['host', 'ui'].map(part => resolve(staging, 'node_modules/@dsh-plugins/model-spokesperson-' + part))]) {
  const file = resolve(directory, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.engines = { ...manifest.engines, dsh: '0.2.1-rc.3' };
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
await mkdir(resolve(root, 'dist'), { recursive: true });
const result = spawnSync('rtk', ['proxy', 'npm', 'pack', staging, '--pack-destination', resolve(root, 'dist'), '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
