import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createAssistantView, presentation, type AssistantProps } from '../src/presentation.tsx';
import type { Rewrite } from '../src/contract.ts';

const row: Rewrite = { schemaVersion: 1, policyVersion: 1, promptVersion: 1, sessionId: 's', turn: 1, step: 1,
  attemptId: 'a1', source: { provider: 'p', model: 'a' }, writer: { provider: 'p', model: 'b' },
  status: 'ready', originalMessageId: 'm', originalText: '复杂原文', rewrittenText: '清楚说明', sourceHash: 'hash', startedAt: 0 };
function props(current: Rewrite | undefined, overrides = {}): AssistantProps {
  return { node: { kind: 'assistant-step', data: { status: 'settled', turn: 1, step: 1, time: 1, blocks: [{ kind: 'text', text: '复杂原文' }], finalNode: { messageId: 'm' } } },
    useProjection: () => current ? { '1:1': current } : {}, ...overrides } as unknown as AssistantProps;
}
const Default = (p: AssistantProps) => <article>{p.node.data.blocks.map((block, i) => <span key={i}>{block.kind === 'text' || block.kind === 'reasoning' ? block.text : '附件'}</span>)}</article>;

test('same row shows B and an original disclosure; raw source objects never mutate', () => {
  const p = props(row), before = JSON.stringify(p.node);
  const View = createAssistantView(Default);
  const render = create(<View {...p} />);
  assert.equal(render.root.findAllByType('article')[0].children[0].children[0], '清楚说明');
  assert.equal(render.root.findByType('details').findByType('article').children[0].children[0], '复杂原文');
  assert.equal(JSON.stringify(p.node), before);
  render.unmount();
});
test('live and durable handoff never flash original while collecting/rewriting', () => {
  const View = createAssistantView(Default);
  const collecting = { ...row, status: 'collecting', originalText: undefined, originalMessageId: undefined } as Rewrite;
  const render = create(<View {...props(collecting)} />);
  assert.ok(!JSON.stringify(render.toJSON()).includes('复杂原文'));
  assert.equal(render.root.findByProps({ role: 'status' }).children[0], '正在整理表达…');
  act(() => render.update(<View {...props({ ...row, status: 'rewriting' })} />));
  assert.ok(!JSON.stringify(render.toJSON()).includes('复杂原文'));
  act(() => render.update(<View {...props(row)} />));
  assert.equal(render.root.findAllByType('article')[0].children[0].children[0], '清楚说明');
  render.unmount();
});
test('history without record, tools, interruption, stale message and changed source fall through', () => {
  assert.equal(presentation(undefined, props(undefined)), 'original');
  const p = props(row);
  for (const patch of [{ finalNode: { messageId: 'different' } }, { blocks: [{ kind: 'text', text: '原文已改变' }] }, { status: 'interrupted' }, { blocks: [{ kind: 'tool-call' }] }]) {
    assert.equal(presentation(row, { ...p, node: { ...p.node, data: { ...p.node.data, ...patch } } } as AssistantProps), 'original');
  }
  assert.equal(presentation({ ...row, status: 'fallback' }, p), 'fallback');
});

test('independent report progress shows drafting/reviewing and never exposes a partial draft', () => {
  const View = createAssistantView(Default);
  const current: Rewrite = { ...row, policyVersion: 2, promptVersion: 2, status: 'rewriting', phase: 'drafting', reviewRound: 0, reviewRounds: 2, stages: [{ kind: 'draft', round: 0, system: '', input: '', output: '未核对的初稿', startedAt: 0 }] };
  const render = create(<View {...props(current)} />);
  assert.equal(render.root.findByProps({ role: 'status' }).children[0], 'B 正在独立起草…');
  assert.ok(!JSON.stringify(render.toJSON()).includes('未核对的初稿'));
  act(() => render.update(<View {...props({ ...current, phase: 'reviewing', reviewRound: 2 })} />));
  assert.equal(render.root.findByProps({ role: 'status' }).children[0], 'B 正在核对完善（2/2）…');
  assert.ok(!JSON.stringify(render.toJSON()).includes('复杂原文'));
  render.unmount();
});
