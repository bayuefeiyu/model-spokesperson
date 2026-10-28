import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types';
import { SettingsView } from '../src/settings-view.tsx';
import { SettingsSchema, type Settings } from '../src/contract.ts';
import { Config, readSettings } from '../src/config.ts';

const rule = { source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } };
const catalog: ModelCatalog = { default: rule.source, routableProviders: ['mock'], failures: [], groups: [{ id: 'mock', name: 'Mock', models: [{id:'a',name:'工作 A'},{id:'b',name:'编辑 B'}] }] };
const label = (node: ReactTestInstance) => node.children.filter(value => typeof value === 'string').join('');
const button = (root: ReactTestInstance, name: string) => root.findAllByType('button').find(node => label(node) === name)!;
function fixture(initial: Partial<Settings> = {}, accept = true) {
  let snapshot: ConfigFormSnapshot<Settings> = { status:'ready', value:SettingsSchema.parse(initial), base:{}, user:{}, revision:3, writable:true };
  const listeners = new Set<() => void>();
  const calls: {ops: unknown; revision: number | undefined}[] = [];
  const form: ConfigForm<Settings> = {
    getSnapshot: () => snapshot,
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    mutate: async (ops, revision) => {
      calls.push({ops, revision});
      if (!accept) return false;
      const next = { ...snapshot.value };
      for (const op of ops) if (op.op === 'set') Object.assign(next, { [op.path[0]]:op.value });
      snapshot = {...snapshot,value:SettingsSchema.parse(next),revision:4};
      for (const listener of listeners) listener();
      return true;
    },
    set: async () => {throw new Error('must save atomically');}, unset: async () => {throw new Error('not used');},
  };
  function external(value: Settings) {snapshot={...snapshot,value,revision:5};for(const listener of listeners)listener();}
  return {form,calls,external};
}

test('native Config refs preserve cross-field validation and serialize editable fields', async () => {
  const good = await Config['~standard'].validate({enabled:true,rules:[rule]});
  assert.ok(!good.issues);
  assert.equal(readSettings(good.value as Parameters<typeof readSettings>[0]).enabled,true);
  for (const candidate of [{enabled:true,rules:[]},{enabled:true,rules:[rule,rule]}]) {
    const bad=await Config['~standard'].validate(candidate);
    assert.ok(bad.issues?.length);
  }
  assert.equal(Config.dict!.rules.meta.volatile,true);
});

test('UI stages A/B choices and saves all changed fields atomically with its original revision', async () => {
  const f=fixture();
  let view: ReturnType<typeof create>;
  await act(async()=>{view=create(<SettingsView form={f.form} loadCatalog={async()=>catalog}/>);});
  act(()=>button(view!.root,'添加模型映射').props.onClick());
  const selects=view!.root.findAllByType('select');
  act(()=>selects[0].props.onChange({target:{value:JSON.stringify(['mock','a'])}}));
  act(()=>selects[1].props.onChange({target:{value:JSON.stringify(['mock','b'])}}));
  act(()=>view!.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  assert.equal(f.calls.length,0);
  await act(async()=>{view!.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].revision,3);
  assert.deepEqual(f.calls[0].ops,[{op:'set',path:['enabled'],value:true},{op:'set',path:['rules'],value:[rule]}]);
  assert.ok(view!.root.findAllByProps({role:'status'}).some(node=>label(node).includes('已保存')));
  view!.unmount();
});

test('UI rejects duplicate source routes and refuses to overwrite a concurrent edit', async () => {
  const f=fixture({enabled:true,rules:[rule]});
  let view: ReturnType<typeof create>;
  await act(async()=>{view=create(<SettingsView form={f.form} loadCatalog={async()=>catalog}/>);});
  act(()=>button(view!.root,'添加模型映射').props.onClick());
  const selects=view!.root.findAllByType('select');
  act(()=>selects[2].props.onChange({target:{value:JSON.stringify(['mock','a'])}}));
  act(()=>selects[3].props.onChange({target:{value:JSON.stringify(['mock','b'])}}));
  assert.equal(button(view!.root,'保存设置').props.disabled,true);
  assert.ok(view!.root.findAllByProps({role:'alert'}).some(node=>label(node).includes('只能配置一次')));
  act(()=>button(view!.root,'放弃修改').props.onClick());
  act(()=>view!.root.findByType('textarea').props.onChange({target:{value:'保留我的修改'}}));
  act(()=>f.external(SettingsSchema.parse({enabled:true,rules:[rule],style:'别处的设置'})));
  assert.equal(view!.root.findByType('textarea').props.value,'保留我的修改');
  assert.equal(button(view!.root,'保存设置').props.disabled,true);
  assert.equal(f.calls.length,0);
  view!.unmount();
});

test('failed saves preserve the draft and an unavailable model never erases its saved route', async () => {
  const missing={...rule,writer:{provider:'old',model:'missing'}};
  const f=fixture({rules:[missing]},false);
  let view: ReturnType<typeof create>;
  await act(async()=>{view=create(<SettingsView form={f.form} loadCatalog={async()=>{throw new Error('offline');}}/>);});
  assert.equal(view!.root.findAllByType('select')[1].props.value,JSON.stringify(['old','missing']));
  act(()=>view!.root.findByType('textarea').props.onChange({target:{value:'新的表达偏好'}}));
  await act(async()=>{view!.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.equal(f.calls.length,1);
  assert.equal(view!.root.findByType('textarea').props.value,'新的表达偏好');
  assert.ok(view!.root.findAllByProps({role:'alert'}).some(node=>label(node).includes('保存未成功')));
  view!.unmount();
});

test('UI saves review rounds and large or unlimited budgets without the old caps', async () => {
  const f = fixture({ enabled: true, rules: [rule], maxInputChars: 30000, maxOutputTokens: 8192 });
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(<SettingsView form={f.form} loadCatalog={async () => catalog} />); });
  const fields = [ ['核对轮数', '3'], ['每次输入字符上限（0 不限）', '0'], ['每次输出 tokens（0 跟随模型）', '100000'] ];
  for (const [name, value] of fields) act(() => view!.root.findByProps({ 'aria-label': name }).props.onChange({ target: { value } }));
  assert.equal(f.calls.length, 0);
  assert.equal(button(view!.root, '保存设置').props.disabled, false);
  await act(async () => { view!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(f.form.getSnapshot().value, SettingsSchema.parse({ enabled: true, rules: [rule], reviewRounds: 3, maxInputChars: 0, maxOutputTokens: 100000 }));
  view!.unmount();
});
