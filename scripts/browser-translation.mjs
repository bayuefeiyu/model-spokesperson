import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = process.argv[2];
const verifyOnly = process.argv.includes('--verify-only');
if (!url) throw new Error('Pass the isolated DSH Web URL as the first argument.');
const checks = [];
const original = 'I recommend option one. Keyboard navigation still needs testing.';
const translated = '建议采用第一种实现。键盘导航还需要测试。';
const calls = async () => (await readFile('.dev/workspace/calls.jsonl', 'utf8'))
  .split('\n').filter(Boolean).map(line => JSON.parse(line));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 3000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();

  async function settings() {
    await page.getByText('插件', { exact: true }).first().click();
    await page.getByRole('button', { name: '查看 @dsh-plugins/model-spokesperson', exact: true }).click();
    await page.getByRole('form', { name: '模型嘴替设置' }).waitFor();
  }
  async function save() {
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  }
  async function send(question) {
    await page.getByText('新会话', { exact: true }).first().click();
    await page.locator('[contenteditable="true"]').first().fill(question);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 20000 });
  }

  await settings();
  if (!verifyOnly) {
    await page.getByRole('button', { name: '添加模型映射', exact: true }).click();
    await page.getByLabel('第 1 组 A 模型（完成工作）').selectOption(JSON.stringify(['spokesperson-mock', 'a']));
    await page.getByLabel('第 1 组 B 模型（独立作答）').selectOption(JSON.stringify(['spokesperson-mock', 'b']));
    await page.getByRole('checkbox', { name: '开启 B 回复', exact: true }).check();
  }
  const project = page.getByLabel('项目', { exact: true });
  await project.waitFor();
  assert.ok(await project.locator('option').count() > 0);
  const workspaceId = await project.inputValue();
  if (!verifyOnly) await page.getByRole('checkbox', { name: '本项目使用英文底稿和中文翻译', exact: true }).check();
  else assert.ok(await page.getByRole('checkbox', { name: '本项目使用英文底稿和中文翻译', exact: true }).isChecked());
  const english = page.getByLabel('A 的英文回复要求', { exact: true });
  const prompt = page.getByLabel('翻译提示词', { exact: true });
  assert.ok((await english.inputValue()).includes('must be written in English'));
  const customPrompt = (await prompt.inputValue()) + (verifyOnly ? '' : '\n用短句表达，保留尚未完成的测试。');
  if (!verifyOnly) await prompt.fill(customPrompt);
  assert.equal(await page.getByLabel('表达偏好', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('核对轮数', { exact: true }).count(), 0);
  if (!verifyOnly) await save();
  checks.push(verifyOnly ? 'project setting and custom prompt survive a server restart' : 'native project selector and translation fields save through ConfigForm');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settings();
  assert.equal(await project.inputValue(), workspaceId);
  assert.ok(await page.getByRole('checkbox', { name: '本项目使用英文底稿和中文翻译', exact: true }).isChecked());
  assert.equal(await prompt.inputValue(), customPrompt);
  checks.push('project choice and custom translation prompt survive reload');

  const before = (await calls()).length;
  await page.evaluate(source => {
    window.__translationOriginalLeaked = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes(source)) window.__translationOriginalLeaked = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, original);
  await send('请添加中文保存按钮并说明哪些测试还没完成 ' + Date.now());
  assert.ok(await page.getByText(translated, { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => window.__translationOriginalLeaked), false);
  const translatedCalls = (await calls()).slice(before);
  assert.deepEqual(translatedCalls.map(call => call.model), ['a', 'b']);
  assert.ok(translatedCalls[0].messages.some(message => message.role === 'system' && JSON.stringify(message.content).includes('[model-spokesperson:english-reply]')));
  assert.equal(translatedCalls[1].messages[0].content[0].text, original);
  assert.ok(translatedCalls[1].system.includes(customPrompt));
  assert.ok(!translatedCalls[1].system.includes('表达偏好'));
  checks.push('actual A request receives the English rule; exactly one B call receives only the English report');
  checks.push('Chinese translation replaces the source row without flashing the English original');
  await page.getByText('查看 A 的原文', { exact: true }).click();
  assert.ok(await page.getByText(original, { exact: true }).isVisible());
  checks.push('original disclosure works');
  const replayCount = (await calls()).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 15000 });
  assert.equal((await calls()).length, replayCount);
  checks.push('refresh replays the saved translation without another model call');
  await page.screenshot({ path: 'evidence/translation-browser.png', fullPage: true });

  await settings();
  await page.getByRole('checkbox', { name: '本项目使用英文底稿和中文翻译', exact: true }).uncheck();
  assert.ok(await page.getByLabel('表达偏好', { exact: true }).isVisible());
  await save();
  const legacyStart = (await calls()).length;
  await send('请解释关闭翻译后的方式 ' + Date.now());
  const legacy = (await calls()).slice(legacyStart);
  assert.deepEqual(legacy.map(call => call.model), ['a', 'b', 'b']);
  assert.ok(!legacy[0].messages.some(message => message.role === 'system' && JSON.stringify(message.content).includes('[model-spokesperson:english-reply]')));
  checks.push('turning off the project option restores legacy drafting and review and removes the current English rule');
  await settings();
  await page.getByRole('checkbox', { name: '本项目使用英文底稿和中文翻译', exact: true }).check();
  await save();
  assert.deepEqual(errors, []);
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const runtime = JSON.parse(await readFile('.dev/runtime/node_modules/@deepseek-ai/dsh/package.json', 'utf8'));
  const result = { pluginVersion: manifest.version, runtimeVersion: runtime.version, browser: 'headless Microsoft Edge', checks, pageErrors: errors, realApiCalls: 0 };
  await writeFile(verifyOnly ? 'evidence/translation-browser-restart.json' : 'evidence/translation-browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await mkdir('evidence/private', { recursive: true });
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await writeFile('evidence/private/translation-failure.txt', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
