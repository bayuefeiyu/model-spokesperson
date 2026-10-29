import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const packageName = manifest.name;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      tag_name: 'v0.2.2',
      draft: false,
      prerelease: true,
      html_url: 'https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v0.2.2',
      assets: [{
        name: 'dsh-plugins-model-spokesperson-0.2.2.tgz',
        browser_download_url: 'https://github.com/bayuefeiyu/model-spokesperson/releases/download/v0.2.2/dsh-plugins-model-spokesperson-0.2.2.tgz',
      }],
    }]),
  }));

  async function openDetail() {
    await page.getByText('插件', { exact: true }).first().click();
    await page.getByRole('button', { name: '查看 ' + packageName, exact: true }).click();
    await page.getByText('包含的组件', { exact: true }).waitFor();
  }

  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 3000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  await openDetail();
  await page.getByText('v0.2.1', { exact: true }).waitFor();
  const update = page.getByRole('button', { name: '更新到 v0.2.2', exact: true });
  await update.waitFor({ timeout: 20_000 });
  const styleBefore = await page.getByLabel('表达偏好').inputValue();
  const reviewsBefore = await page.getByLabel('核对轮数').inputValue();
  assert.equal(styleBefore, '结论先行，保留事实。');
  assert.equal(reviewsBefore, '2');

  await update.click();
  await page.waitForFunction(() => document.body.innerText.includes('v0.2.2'), undefined, { timeout: 120_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const proceedAgain = page.getByRole('button', { name: '继续', exact: true });
  await proceedAgain.waitFor({ timeout: 3000 }).catch(() => {});
  if (await proceedAgain.isVisible()) await proceedAgain.click();
  await openDetail();
  await page.getByText('v0.2.2', { exact: true }).waitFor();
  const text = await page.locator('body').innerText();
  assert.ok(text.includes('dsh-plugins-model-spokesperson-0.2.2.tgz'));
  assert.equal(await page.getByLabel('表达偏好').inputValue(), styleBefore);
  assert.equal(await page.getByLabel('核对轮数').inputValue(), reviewsBefore);
  assert.ok(text.includes('Mock B · b'));
  await page.screenshot({ path: 'evidence/update-e2e.png', fullPage: true });
  const result = {
    from: '0.2.1', to: '0.2.2', source: 'release tarball dsh-plugins-model-spokesperson-0.2.2.tgz',
    settingsPreserved: true, style: styleBefore, reviewRounds: reviewsBefore,
    apiTransport: 'intercepted release metadata; install used the real public release asset', pageErrors: errors,
  };
  await writeFile('evidence/update-e2e.json', JSON.stringify(result, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
