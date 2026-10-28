import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create } from 'react-test-renderer';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from '@deepseek-ai/cordis';
import { apply } from '../src/client.ts';

test('minified registrants, authorized child delegation, late declarations and unload use the real slot registry', async () => {
  const core = new SlotCore();
  const register = core.register as unknown as (options: Record<string, unknown>, component: React.ComponentType<Record<string, unknown>>) => () => void;
  const cleanups: (() => void)[] = [];
  const slots = {
    entries: core.entries.bind(core), subscribe: core.subscribe.bind(core),
    register(options: Record<string, unknown>, component: React.ComponentType<Record<string, unknown>>) {
      assert.equal(this, slots, 'service methods must retain the receiver');
      return register.call(core, options, component);
    },
  };
  apply({ slots, inject: () => {}, effect: (fn: () => () => void) => { const undo = fn(); cleanups.push(undo); return undo; } } as unknown as Context);
  const root = register.call(core, { name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null);
  const Default = (p: Record<string, unknown>) => <>{(p.renderSlot as (name: string) => React.ReactNode)('conversation.chat.reasoning.body')}{(p.renderSlot as (name: string) => React.ReactNode)('conversation.chat.message.images')}</>;
  const original = register.call(core, { name: 'conversation.chat.node', key: 'assistant-step', registrant: 'Gb', children: {
    'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
    'conversation.chat.message.images': { kind: 'single', scope: 'session' },
  } }, Default);
  const reason = register.call(core, { name: 'conversation.chat.reasoning.body' }, () => <span>reasoning</span>);
  const image = register.call(core, { name: 'conversation.chat.message.images' }, () => <span>image</span>);
  await new Promise(resolve => setTimeout(resolve, 0));
  const elected = core.entriesOfSlot('conversation.chat.node')[0];
  assert.equal(elected.options.priority, -10);
  const View = elected.component as React.ComponentType<Record<string, unknown>>;
  const render = create(<View node={{ data: { turn: 1, step: 1, blocks: [] } }} useProjection={() => ({})} renderSlot={(key: string) => {
    assert.ok(elected.children?.[key], 'only declared aliases may be rendered');
    const Entry = core.entriesOfSlot(key as 'root')[0].component as React.ComponentType;
    return <Entry />;
  }} />);
  assert.deepEqual(render.root.findAllByType('span').map(span => span.children.join('')), ['reasoning', 'image']);
  render.unmount();
  for (const undo of cleanups.reverse()) undo();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(core.entriesOfSlot('conversation.chat.node')[0].component, Default);
  assert.equal(core.spec('model-spokesperson.reasoning.body' as 'root'), undefined);
  reason(); image(); original(); root();
});
