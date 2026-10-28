import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const home = resolve(root, '.dev/runtime/spokesperson-home');
const workspace = resolve(root, '.dev/workspace');
await mkdir(home, { recursive: true });
await mkdir(workspace, { recursive: true });
const child = spawn('rtk', ['proxy', process.execPath, resolve(root, '.dev/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), ...process.argv.slice(2)], {
  cwd: workspace, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, DSH_HOME: home },
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', code => { process.exitCode = code ?? 1; });
