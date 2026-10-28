import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const profile = process.argv[3] ?? 'spokesperson-report';
const verifyOnly = process.argv.includes('--verify-only');
const configPath = '.dev/runtime/spokesperson-home/profiles/'+profile+'/cordis.patch.yml';
const calls = async () => (await readFile('.dev/workspace/calls.jsonl','utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const browser = await chromium.launch({channel:'msedge',headless:true});
const checks = [];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(process.argv[2],{waitUntil:'domcontentloaded'});
  const proceed=page.getByRole('button',{name:'继续',exact:true});
  await proceed.waitFor({timeout:2500}).catch(()=>{});
  if(await proceed.isVisible())await proceed.click();
  async function openSettings(){
    await page.getByText('插件',{exact:true}).first().click();
    await page.getByRole('button',{name:'查看 @dsh-plugins/model-spokesperson',exact:true}).click();
    await page.getByRole('form',{name:'模型嘴替设置'}).waitFor({timeout:15000});
  }
  async function saved(){
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByRole('status').filter({hasText:'已保存'}).waitFor({timeout:15000});
  }
  async function verify(){
    assert.ok(await page.getByRole('checkbox',{name:'开启 B 回复'}).isChecked());
    assert.equal(await page.getByLabel('第 1 组 A 模型（完成工作）').inputValue(),JSON.stringify(['spokesperson-mock','a']));
    assert.equal(await page.getByLabel('第 1 组 B 模型（独立作答）').inputValue(),JSON.stringify(['spokesperson-mock','b']));
    assert.equal(await page.getByLabel('表达偏好').inputValue(),'结论先行，保留事实。');
    assert.equal(await page.getByLabel('核对轮数',{exact:true}).inputValue(),'2');
    assert.equal(await page.getByLabel('每次输入字符上限（0 不限）').inputValue(),'0');
  }
  await openSettings();
  if(verifyOnly){await verify();checks.push('saved settings survive process restart');}
  else{
    const before=await readFile(configPath,'utf8');
    assert.equal(await page.getByRole('checkbox',{name:'开启 B 回复'}).isChecked(),false);
    await page.getByRole('button',{name:'添加模型映射',exact:true}).click();
    await page.getByLabel('第 1 组 A 模型（完成工作）').selectOption(JSON.stringify(['spokesperson-mock','a']));
    await page.getByLabel('第 1 组 B 模型（独立作答）').selectOption(JSON.stringify(['spokesperson-mock','b']));
    await page.getByRole('checkbox',{name:'开启 B 回复'}).check();
    await page.getByLabel('表达偏好').fill('结论先行，保留事实。');
    await page.getByLabel('核对轮数',{exact:true}).fill('2');
    await page.getByText('高级设置',{exact:true}).click();
    await page.getByLabel('每次输出 tokens（0 跟随模型）').fill('100000');
    assert.equal(await readFile(configPath,'utf8'),before);
    checks.push('A/B selections stay staged until Save');
    await saved();
    assert.notEqual(await readFile(configPath,'utf8'),before);
    checks.push('native settings save persists to active profile');
    await page.reload({waitUntil:'domcontentloaded'});await openSettings();await verify();
    checks.push('reload restores the selected routes and style');
    const start=(await calls()).length;
    await page.getByText('新会话',{exact:true}).first().click();
    await page.locator('[contenteditable="true"]').first().fill('请解释这个方案');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.locator('[data-model-spokesperson="ready"]').waitFor({timeout:15000});
    const after=(await calls()).slice(start);
    assert.deepEqual(after.map(call=>call.model),['a','b','b','b']);
    assert.ok(after[1].system.includes('结论先行，保留事实。'));
    assert.equal(after[1].maxTokens,100000);
    const input=call=>JSON.parse(call.messages[0].content[0].text);
    assert.ok(!JSON.stringify(input(after[1])).includes('针对当前事项，综合考量后建议采用第一种实现。'));
    assert.equal(input(after[2]).ownDraft,'建议采用第一种实现。');
    assert.equal(input(after[2]).sourceReport,'针对当前事项，综合考量后建议采用第一种实现。');
    assert.equal(input(after[3]).reviewRound,2);
    checks.push('next answer uses saved B/style/100000 tokens and two reviews; draft excludes A report');
    await openSettings();await page.getByRole('checkbox',{name:'开启 B 回复'}).uncheck();await saved();
    const offStart=(await calls()).length;
    await page.getByText('新会话',{exact:true}).first().click();
    await page.locator('[contenteditable="true"]').first().fill('请解释关闭后的行为');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByText('针对当前事项，综合考量后建议采用第一种实现。',{exact:true}).waitFor({timeout:15000});
    assert.deepEqual((await calls()).slice(offStart).map(call=>call.model),['a']);
    checks.push('disabling in the UI stops B on the next answer');
    await openSettings();await page.getByRole('checkbox',{name:'开启 B 回复'}).check();await saved();await verify();
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'evidence/report-settings.png',fullPage:true});
  const result={version:'0.2.0',profile,checks,pageErrors:errors,realApiCalls:0};
  await writeFile(verifyOnly?'evidence/report-settings-restart.json':'evidence/report-settings.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}catch(error){
  const page=browser.contexts()[0]?.pages()[0];
  if(page){await writeFile('evidence/private/settings-failure.txt',await page.locator('body').innerText());await page.screenshot({path:'evidence/private/settings-failure.png',fullPage:true});}
  throw error;
}finally{await browser.close();}
