import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 3000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  await page.getByText('插件', { exact: true }).first().click();
  await page.getByRole('button', { name: '查看 '+manifest.name, exact: true }).click();
  await page.getByText('包含的组件', { exact: true }).waitFor();
  await page.getByText('v'+manifest.version, { exact: true }).waitFor();
  assert.equal(await page.getByText('model-spokesperson-host', { exact: true }).count(), 1);
  assert.equal(await page.getByText('model-spokesperson-ui', { exact: true }).count(), 1);
  const switches = page.getByRole('switch');
  assert.equal(await switches.count(), 3);
  for (const control of await switches.all()) assert.ok(await control.isEnabled());
  const bundle = page.getByRole('switch', { name: '启用 '+manifest.name, exact: true });
  assert.equal(await bundle.getAttribute('aria-checked'), 'true');
  await bundle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 @dsh-plugins/model-spokesperson"]')?.getAttribute('aria-checked') === 'false');
  await bundle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 @dsh-plugins/model-spokesperson"]')?.getAttribute('aria-checked') === 'true');
  const text = await page.locator('body').innerText();
  assert.ok(!text.includes('没有声明组合包'));
  if (process.argv[3] === 'github') assert.ok(text.includes('github.com/bayuefeiyu/model-spokesperson'));
  assert.deepEqual(errors, []);
  const result = { version: manifest.version, source: process.argv[3] ?? 'tarball', bundleRecognized: true,
    components: ['model-spokesperson-host','model-spokesperson-ui'], bundleDisabledAndReenabled: true, pageErrors: errors };
  await writeFile('evidence/plugin-manager-'+result.source+'.json', JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
