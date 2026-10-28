import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';

test('the GitHub repository root is a ready-to-load DSH bundle without build lifecycle scripts', async () => {
  const root = resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@dsh-plugins/model-spokesperson');
  assert.ok(manifest.version);
  assert.ok(manifest.dsh?.bundle?.patch, 'GitHub URL inspection reads the root manifest');
  assert.equal(manifest.scripts.prepare, undefined, 'installation must not depend on executing a build');
  assert.ok((await stat(resolve(root, manifest.main))).isFile());
  const patches = bundlePatchPaths(root, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('dsh', path));
  const entries = composeEntries([patches]);
  assert.deepEqual(entries.map(entry => entry.id), ['model-spokesperson-host', 'model-spokesperson-ui']);
  assert.equal((entries[0].config as { enabled: boolean }).enabled, false);
  for (const entry of entries) {
    assert.equal(typeof entry.name, 'string');
    const entryPath = fileURLToPath(entry.name as string);
    assert.ok((await stat(entryPath)).isFile(), 'committed distribution must include '+entryPath);
  }
  const ui = JSON.parse(await readFile(resolve(root, 'packages/ui/package.json'), 'utf8'));
  const client = resolve(root, 'packages/ui', ui.exports['./client']);
  const source = await readFile(client, 'utf8');
  assert.ok(source.includes('window.__ModuleLoader__.load'));
  assert.ok(!source.includes('require("@deepseek-ai/dsh-typert-protocol/remote-info")'), 'rc.3 does not expose the pure metadata helper in its Client module table');
});
