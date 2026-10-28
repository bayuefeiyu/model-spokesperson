import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = new URL(process.argv[2]);
const route = JSON.parse(await readFile('evidence/private/chat-route.json', 'utf8'));
const url = new URL(route.pathname + route.search + route.hash, base);
url.searchParams.set('token', base.searchParams.get('token'));
const mode = process.argv[3] ?? 'ready';
const count = async () => (await readFile('.dev/workspace/calls.jsonl', 'utf8')).trim().split('\n').length;
const before = await count();
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  // This UI stores navigation in client state rather than its URL. Select the
  // most recent named conversation produced by browser-e2e in this test home.
  await page.getByText('请解释这个方案', {exact:true}).first().click();
  if (mode === 'ready') await page.locator('[data-model-spokesperson="ready"]').waitFor();
  else {
    await page.getByText('针对当前事项，综合考量后建议采用第一种实现。', {exact:true}).waitFor();
    assert.equal(await page.locator('[data-model-spokesperson="ready"]').count(),0);
  }
  assert.equal(await count(),before);
  assert.deepEqual(errors,[]);
  const result = {mode,historyWithoutNewCalls:true,pageErrors:errors};
  await writeFile('evidence/history-'+mode+'.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {await browser.close();}
