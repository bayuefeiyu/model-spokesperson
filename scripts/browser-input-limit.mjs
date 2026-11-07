import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const calls = async () => (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 2500 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  async function settings() {
    await page.getByText('插件', { exact: true }).first().click();
    await page.getByRole('button', { name: '查看 @dsh-plugins/model-spokesperson', exact: true }).click();
    await page.getByRole('form', { name: '模型嘴替设置' }).waitFor({ timeout: 15000 });
    const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^高级设置$/ }) });
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
  }
  async function save() {
    const button = page.getByRole('button', { name: '保存设置', exact: true });
    if (!await button.isEnabled()) return;
    await button.click();
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor({ timeout: 15000 });
  }
  const limitField = () => page.getByLabel('每次输入字符上限（0 不限）', { exact: true });
  await settings();
  const originalLimit = await limitField().inputValue();
  const originalRounds = await page.getByLabel('核对轮数', { exact: true }).inputValue();
  await limitField().fill('1000');
  await page.getByLabel('核对轮数', { exact: true }).fill('1');
  await save();
  const before = (await calls()).length;
  await page.getByText('新会话', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.locator('[contenteditable="true"]').first().fill(`输入预算回归 ${Date.now()} ${'材'.repeat(600)}`);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const retry = page.getByRole('button', { name: '重试 B 回复', exact: true });
  await retry.waitFor({ timeout: 15000 });
  const chatUrl = page.url();
  const hint = page.getByText(/本次 B 输入为 .*超过设置上限 1,000 个字符/).first();
  await hint.waitFor();
  assert.ok((await hint.innerText()).includes('0（不限）'));
  assert.deepEqual((await calls()).slice(before).map(call => call.model), ['a']);
  // A's final driver cleanup may lag the immediate pre-call budget failure.
  await page.waitForTimeout(500);
  await retry.click();
  await page.getByRole('alert').filter({ hasText: '超过设置上限 1,000' }).waitFor();
  assert.deepEqual((await calls()).slice(before).map(call => call.model), ['a']);
  await page.screenshot({ path: 'evidence/input-limit.png', fullPage: true });
  await settings();
  await limitField().fill('0');
  await save();
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
  await retry.waitFor({ timeout: 15000 });
  await retry.click();
  await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 20000 });
  assert.deepEqual((await calls()).slice(before).map(call => call.model), ['a', 'b', 'b']);
  const count = (await calls()).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 15000 });
  assert.equal((await calls()).length, count);
  await settings();
  await limitField().fill(originalLimit);
  await page.getByLabel('核对轮数', { exact: true }).fill(originalRounds);
  if (await page.getByRole('button', { name: '保存设置', exact: true }).isEnabled()) await save();
  assert.deepEqual(errors, []);
  const result = { version: '0.2.4', checks: [
    'native chat shows measured characters, limit and settings remedy before any B call',
    'blocked retry returns a visible admission error and makes no model call',
    'saving limit 0 through native settings permits retry with only B draft/review calls',
    'reload restores final B without extra calls',
  ], pageErrors: errors, realApiCalls: 0 };
  await writeFile('evidence/input-limit-browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await writeFile('evidence/private/input-limit-failure.txt', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
