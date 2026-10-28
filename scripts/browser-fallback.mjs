import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const count = async () => (await readFile('.dev/workspace/calls.jsonl','utf8')).trim().split('\n').length;
const before = await count();
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto(process.argv[2],{waitUntil:'domcontentloaded'});
  await page.locator('[contenteditable="true"]').first().fill('请解释这个方案 fail');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByRole('status').filter({hasText:'整理未完成，已显示原文。'}).waitFor({timeout:15000});
  assert.ok(await page.getByText('针对当前事项，综合考量后建议采用第一种实现。',{exact:true}).isVisible());
  assert.equal(await page.locator('[data-model-spokesperson="ready"]').count(),0);
  assert.equal(await count()-before,2,'one A and one B; no repeated work');
  assert.deepEqual(errors,[]);
  const result={fallbackToOriginal:true,modelCalls:2,sourceRepeated:false,pageErrors:errors,realApiCalls:0};
  await writeFile('evidence/browser-fallback.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {await browser.close();}
