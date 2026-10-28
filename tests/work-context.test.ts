import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '@deepseek-ai/dsh-llm';
import { captureWorkContext } from '../src/work-context.ts';
import type { Rewrite } from '../src/contract.ts';

test('context excludes A persona/reasoning/replay and uses previously displayed B replies', () => {
  const messages = [
    { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'A 专属写作风格' }] },
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '检查项目' }] },
    { id: 'tool-call', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'a', replayState: { secret: 'provider-replay' } }, content: [{ type: 'reasoning', text: 'A 内部思考' }, { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"file.ts"}' }] },
    { id: 't1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', isError: true, content: [{ type: 'text', text: '文件不存在' }] },
    { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'a' }, content: [{ type: 'text', text: 'A 之前的成稿措辞' }] },
    { id: 'notice', role: 'user', source: { kind: 'model-spokesperson' }, content: [{ type: 'text', text: '重复的同步通知' }] },
    { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续分析' }, { type: 'image', attachment: {} }] },
  ] as unknown as Message[];
  const row: Rewrite = { schemaVersion: 1, policyVersion: 1, promptVersion: 1, sessionId: 's', turn: 1, step: 1, attemptId: 'x', source: { provider: 'p', model: 'a' }, writer: { provider: 'p', model: 'b' }, status: 'ready', originalMessageId: 'a1', originalText: 'A 之前的成稿措辞', rewrittenText: '用户看见的 B 回复', startedAt: 0 };
  const before = JSON.stringify(messages);
  const context = captureWorkContext(messages, { '1:1': row });
  const data = JSON.stringify(context);
  for (const excluded of ['A 专属写作风格', 'A 内部思考', 'provider-replay', 'A 之前的成稿措辞', '重复的同步通知']) assert.ok(!data.includes(excluded), excluded);
  for (const included of ['file.ts', '文件不存在', '用户看见的 B 回复', '检查项目']) assert.ok(data.includes(included), included);
  assert.equal(context.userQuestion, '继续分析');
  assert.equal(context.workContext.find(message => message.role === 'tool')?.isError, true);
  assert.ok(data.includes('附件内容未提供'));
  assert.equal(JSON.stringify(messages), before);
  // Stale/deleted presentations cannot replace different raw source text.
  assert.ok(JSON.stringify(captureWorkContext(messages, { '1:1': { ...row, originalText: '不同的原文' } })).includes('A 之前的成稿措辞'));
});
