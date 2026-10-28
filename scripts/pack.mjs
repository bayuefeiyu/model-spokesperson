import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!manifest.dsh?.bundle?.patch) throw new Error('Repository root must declare dsh.bundle.patch');
await mkdir(resolve(root, 'dist'), { recursive: true });
// Pack the same root that GitHub URL installs inspect. No separate generated manifest.
const result = spawnSync('rtk', ['proxy', 'npm', 'pack', root, '--pack-destination', resolve(root, 'dist'), '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
