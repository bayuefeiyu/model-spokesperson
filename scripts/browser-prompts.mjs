import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DRAFT_SYSTEM, REVIEW_SYSTEM } from '../src/prompt.ts';
const profile = process.argv[3] ?? 'spokesperson-report';
if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Invalid isolated profile');
const verifyOnly = process.argv.includes('--verify-only');
const configPath = '.dev/runtime/spokesperson-home/profiles/' + profile + '/cordis.patch.yml';
const customDraft = '自定义独立起草提示词：根据 userQuestion 和 workContext 自己组织回答。\n保留事实，结论先行。';
const customReview = '自定义核对完善提示词：以 ownDraft 为底稿，参考 sourceReport 查漏纠错。\n保留自己报告的表达与结构。';
const calls = async () => (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 2500 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  async function openSettings() {
    await page.getByText('插件', { exact: true }).first().click();
    await page.getByRole('button', { name: '查看 @dsh-plugins/model-spokesperson', exact: true }).click();
    await page.getByRole('form', { name: '模型嘴替设置' }).waitFor({ timeout: 15000 });
    const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^提示词设置$/ }) });
    if (!await details.getAttribute('open').then(value => value !== null)) await details.locator('summary').click();
  }
  async function saved() {
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor({ timeout: 15000 });
  }
  async function verifyCustom() {
    assert.equal(await page.getByLabel('独立起草提示词', { exact: true }).inputValue(), customDraft);
    assert.equal(await page.getByLabel('核对完善提示词', { exact: true }).inputValue(), customReview);
  }
  await openSettings();
  if (verifyOnly) {
    await verifyCustom();
    checks.push('custom multiline prompts survive process restart/reinstallation');
  } else {
    assert.equal(await page.getByLabel('独立起草提示词', { exact: true }).inputValue(), DRAFT_SYSTEM);
    assert.equal(await page.getByLabel('核对完善提示词', { exact: true }).inputValue(), REVIEW_SYSTEM);
    checks.push('legacy profile preloads both complete default prompts');
    const before = await readFile(configPath, 'utf8');
    await page.getByLabel('独立起草提示词', { exact: true }).fill(customDraft);
    await page.getByLabel('核对完善提示词', { exact: true }).fill(customReview);
    assert.equal(await readFile(configPath, 'utf8'), before);
    await saved();
    await page.reload({ waitUntil: 'domcontentloaded' }); await openSettings(); await verifyCustom();
    checks.push('multiline edits remain staged until Save and persist after reload');
    const style = await page.getByLabel('表达偏好', { exact: true }).inputValue();
    const reviewRounds = Number(await page.getByLabel('核对轮数', { exact: true }).inputValue());
    const start = (await calls()).length;
    await page.getByText('新会话', { exact: true }).first().click();
    await page.locator('[contenteditable="true"]').first().fill('验证自定义提示词');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 20000 });
    const after = (await calls()).slice(start);
    assert.deepEqual(after.map(call => call.model), ['a', ...Array(reviewRounds + 1).fill('b')]);
    assert.equal(after[1].system, customDraft + '\n表达偏好：' + style);
    for (const call of after.slice(2)) assert.equal(call.system, customReview + '\n表达偏好：' + style);
    checks.push('saved prompts replace complete stage systems in actual B calls without restart');
    await openSettings();
    const savedConfig = await readFile(configPath, 'utf8');
    await page.getByRole('button', { name: '恢复默认起草提示词', exact: true }).click();
    assert.equal(await page.getByLabel('核对完善提示词', { exact: true }).inputValue(), customReview);
    await page.getByRole('button', { name: '恢复默认核对提示词', exact: true }).click();
    assert.equal(await page.getByLabel('独立起草提示词', { exact: true }).inputValue(), DRAFT_SYSTEM);
    assert.equal(await page.getByLabel('核对完善提示词', { exact: true }).inputValue(), REVIEW_SYSTEM);
    assert.equal(await page.getByLabel('表达偏好', { exact: true }).inputValue(), style);
    assert.equal(await readFile(configPath, 'utf8'), savedConfig);
    await saved();
    await page.reload({ waitUntil: 'domcontentloaded' }); await openSettings();
    assert.equal(await page.getByLabel('独立起草提示词', { exact: true }).inputValue(), DRAFT_SYSTEM);
    assert.equal(await page.getByLabel('核对完善提示词', { exact: true }).inputValue(), REVIEW_SYSTEM);
    checks.push('per-stage Restore remains staged until Save; defaults persist after reload');
    await page.getByLabel('独立起草提示词', { exact: true }).fill(customDraft);
    await page.getByLabel('核对完善提示词', { exact: true }).fill(customReview);
    await saved(); await verifyCustom();
  }
  assert.deepEqual(errors, []);
  const promptSection = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^提示词设置$/ }) });
  await promptSection.scrollIntoViewIfNeeded();
  await promptSection.screenshot({ path: 'evidence/prompt-settings.png' });
  const result = { version: '0.2.1', profile, checks, pageErrors: errors, realApiCalls: 0 };
  await writeFile(verifyOnly ? 'evidence/prompt-restart.json' : 'evidence/prompt-settings.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) { await writeFile('evidence/private/prompt-failure.txt', await page.locator('body').innerText()); await page.screenshot({ path: 'evidence/private/prompt-failure.png', fullPage: true }); }
  throw error;
} finally { await browser.close(); }
