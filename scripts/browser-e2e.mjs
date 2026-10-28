import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 5000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__originalLeaked = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes('针对当前事项，综合考量后建议采用第一种实现。')) window.__originalLeaked = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator('[contenteditable="true"]').first().fill('请解释这个方案');
  await page.waitForTimeout(300);
  await writeFile('evidence/private/editor.html', await page.locator('body').innerHTML());
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'B 正在独立起草' }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('针对当前事项，综合考量后建议采用第一种实现。', { exact: true }).count(), 0);
  checks.push('candidate original never displayed while pending');
  await page.getByRole('status').filter({ hasText: 'B 正在核对完善' }).waitFor({ timeout: 15000 });
  checks.push('drafting and review progress are visible without exposing drafts');
  await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 15000 });
  assert.ok(await page.getByText('建议采用第一种实现。', { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => window.__originalLeaked), false, 'raw A must never flash before disclosure');
  await page.getByText(/^已完成，用时/).click();
  await page.getByText('已完成分析', { exact: true }).click();
  await page.getByText('只供验证的思考。', { exact: true }).waitFor({timeout:5000});
  checks.push('official reasoning disclosure remains usable');
  await page.getByText('查看 A 的原文', { exact: true }).click();
  assert.ok(await page.getByText('针对当前事项，综合考量后建议采用第一种实现。', { exact: true }).isVisible());
  checks.push('B in original row with working original disclosure');
  const callsBefore = (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 15000 });
  const callsAfter = (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').length;
  assert.equal(callsAfter, callsBefore);
  checks.push('refresh replays saved rewrite with no new model calls');
  await mkdir('evidence', { recursive: true });
  await page.screenshot({ path: 'evidence/report-chat.png', fullPage: true });
  const route = new URL(page.url());
  route.searchParams.delete('token');
  await writeFile('evidence/private/chat-route.json', JSON.stringify({ pathname: route.pathname, search: route.search, hash: route.hash }));
  assert.deepEqual(errors, []);
  await writeFile('evidence/report-chat.json', JSON.stringify({ version: '0.2.0', runtime: '0.2.1-rc.3', browser: 'headless Microsoft Edge', checks, pageErrors: errors, realApiCalls: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, pageErrors: errors }));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) { await mkdir('evidence/private', { recursive: true }); await writeFile('evidence/private/e2e-failure.txt', await page.locator('body').innerText()); await page.screenshot({ path: 'evidence/private/e2e-failure.png', fullPage: true }); }
  throw error;
} finally { await browser.close(); }
