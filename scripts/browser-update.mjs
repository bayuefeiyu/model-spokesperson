import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const url = process.argv[2];
const expectedCurrent = process.argv[3] ?? manifest.version;
const fixtureTag = process.argv[4];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  if (fixtureTag) {
    const version = fixtureTag.replace(/^v/, '');
    await page.route('https://api.github.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        tag_name: fixtureTag,
        draft: false,
        prerelease: true,
        html_url: 'https://github.com/bayuefeiyu/model-spokesperson/releases/tag/' + fixtureTag,
        assets: [{
          name: `dsh-plugins-model-spokesperson-${version}.tgz`,
          browser_download_url: `https://github.com/bayuefeiyu/model-spokesperson/releases/download/${fixtureTag}/dsh-plugins-model-spokesperson-${version}.tgz`,
        }],
      }]),
    }));
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 3000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  await page.getByText('插件', { exact: true }).first().click();
  await page.getByRole('button', { name: '查看 ' + manifest.name, exact: true }).click();
  await page.getByText('包含的组件', { exact: true }).waitFor();
  await page.getByText('v' + expectedCurrent, { exact: true }).waitFor();
  const action = page.getByRole('button', { name: /^(已是最新|更新到 v|重试检查)/ });
  await action.waitFor({ timeout: 20_000 });
  const initial = await action.innerText();
  assert.ok(!initial.startsWith('重试检查'), 'update check failed: ' + await page.locator('body').innerText());
  let result = { current: expectedCurrent, action: initial, updated: false, pageErrors: errors };
  if (initial.startsWith('更新到 v')) {
    await action.click();
    const outcome = page.getByText(/已更新到 v|已安装 v|重启 DSH 后生效|更新失败|不兼容|重试更新/);
    await outcome.waitFor({ timeout: 120_000 });
    const text = await page.locator('body').innerText();
    result.actionAfter = text.includes('刷新页面') ? 'applied' : text.includes('重启 DSH') ? 'restart-required' : 'failed';
    result.updated = result.actionAfter === 'applied';
    if (result.updated) {
      await page.getByRole('button', { name: '刷新页面', exact: true }).click();
      await page.waitForLoadState('domcontentloaded');
      await page.getByText('v' + manifest.version, { exact: true }).waitFor();
      result.newVersion = manifest.version;
    }
  }
  await page.screenshot({ path: 'evidence/update-action.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile('evidence/update-check.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
