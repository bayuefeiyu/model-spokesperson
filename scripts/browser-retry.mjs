import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const resumeOnly = process.argv.includes('--resume-only');
const calls = async () => (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const inputOf = call => JSON.parse(call.messages[0].content[0].text);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ timeout: 2500 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  async function start(question) {
    await page.getByText('新会话', { exact: true }).first().click();
    // Native new-conversation selection replaces the composer asynchronously.
    await page.waitForTimeout(500);
    await page.locator('[contenteditable="true"]').first().fill(question);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('button', { name: '重试 B 回复', exact: true }).waitFor({ timeout: 15000 });
  }
  async function retry(question, draftFailed) {
    const before = (await calls()).length;
    await page.getByRole('button', { name: '重试 B 回复', exact: true }).click();
    await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 20000 });
    const after = (await calls()).slice(before);
    assert.ok(after.length > 0 && after.every(call => call.model === 'b'), 'retry must call only B');
    assert.ok(after.every(call => inputOf(call).userQuestion === question));
    const drafts = after.filter(call => !inputOf(call).ownDraft);
    assert.equal(drafts.length, draftFailed ? 1 : 0, 'completed draft must not be repeated');
    assert.ok(await page.getByText('建议采用第一种实现。', { exact: true }).isVisible());
    assert.equal(await page.getByRole('button', { name: '重试 B 回复', exact: true }).count(), 0);
    const count = (await calls()).length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-model-spokesperson="ready"]').waitFor({ timeout: 15000 });
    assert.equal((await calls()).length, count);
    return after.length;
  }
  if (resumeOnly) {
    const { question } = JSON.parse(await readFile('evidence/private/retry-history.json', 'utf8'));
    await page.getByText(question, { exact: true }).first().click();
    await page.getByRole('button', { name: '重试 B 回复', exact: true }).waitFor({ timeout: 15000 });
    const count = await retry(question, false);
    checks.push('cold persisted failure resumes via native session controller, retries only B and reuses saved draft');
    checks.push('successful historical retry reloads without further model calls');
    checks.push('historical retry B calls: ' + count);
  } else {
    const stamp = Date.now();
    const review = 'retry-review-once ' + stamp;
    await start(review);
    await page.screenshot({ path: 'evidence/retry-button.png', fullPage: true });
    const reviewCalls = await retry(review, false);
    checks.push('review failure exposes Retry B button; only failed/remaining reviews run (' + reviewCalls + ' B calls)');
    const draft = 'retry-draft-once ' + stamp;
    await start(draft);
    const draftCalls = await retry(draft, true);
    checks.push('draft failure retries draft and configured reviews without repeating A (' + draftCalls + ' B calls)');
    checks.push('ready results replace original row; reload never repeats successful B');
    const question = 'retry-review-once history-' + stamp;
    await start(question);
    await writeFile('evidence/private/retry-history.json', JSON.stringify({ question }));
    checks.push('saved one failed review for restart/reinstallation verification');
  }
  assert.deepEqual(errors, []);
  const result = { version: '0.2.2', checks, pageErrors: errors, realApiCalls: 0 };
  await writeFile(resumeOnly ? 'evidence/retry-restart.json' : 'evidence/retry-browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) { await writeFile('evidence/private/retry-failure.txt', await page.locator('body').innerText()); await page.screenshot({ path: 'evidence/private/retry-failure.png', fullPage: true }); }
  throw error;
} finally { await browser.close(); }
