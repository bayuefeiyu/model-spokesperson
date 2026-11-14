import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit';
import { LlmAdapter, createUserMessage, ToolCallId, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session';
import * as Host from '../src/host.ts';
import { PROJECTION, RECORD, type RetryRequest, type Settings, type Rewrite } from '../src/contract.ts';
import { ENGLISH_REPLY_RULE, TRANSLATION_MARKER, TRANSLATE_SYSTEM } from '../src/prompt.ts';

async function* text(value: string): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: value };
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
  yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { native: 'source-replay' } } };
}
type Generate = (options: GenerateOptions) => AsyncIterable<StreamChunk>;
class MockAdapter extends LlmAdapter {
  calls: GenerateOptions[] = [];
  constructor(private readonly generate: Generate) { super(); }
  async *stream(options: GenerateOptions) { this.calls.push(options); yield* this.generate(options); }
}
export async function fixture(generate: Generate, overrides: Partial<Settings> = {}, project: { cwd: string; workspaceId: string } = { cwd: process.cwd(), workspaceId: 'ws-1' }) {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  provideWorkingDirectoryFixture(ctx, process.cwd() + '/.dev/workspace');
  if (project) {
    (ctx as unknown as { provide(name: string, value: unknown): () => void }).provide('workspaceRegistry', {
      resolveByPath: async (path: string) => path === project.cwd ? { id: project.workspaceId } : undefined,
    });
  }
  const adapter = new MockAdapter(generate);
  ctx.llm.registerAdapter(['mock', 'other'], adapter);
  const fiber = await ctx.plugin(Host, { enabled: true, translationWorkspaces: ['ws-1'], rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], ...overrides });
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('test-' + crypto.randomUUID()), { provider: 'mock', model: 'a' }, project ? { cwd: project.cwd } : undefined);
  const prompt = async (question = '请解释结果') => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: question }] }));
    await agent.whenIdle();
  };
  const rows = () => Object.values(ctx.sessionProjections.stateOf(agent.session, PROJECTION)!.rows);
  async function waitRow(predicate: (row: Rewrite) => boolean = row => row.status === 'ready') {
    for (let i = 0; i < 300; i++) { const row = rows().findLast(predicate); if (row) return row; await delay(5); }
    assert.fail('No expected rewrite row: ' + JSON.stringify(rows()));
  }
  return { ctx, adapter, agent, harness, fiber, prompt, rows, waitRow };
}

test('A original/replay remains intact; B is tool-free and separately accounted; next user step receives logged display text once', async () => {
  const f = await fixture(options => text(options.model === 'b' ? '结论清楚。' : '原始的说明。'));
  try {
    await f.prompt();
    const row = await f.waitRow();
    assert.equal(row.originalText, '原始的说明。');
    assert.equal(row.rewrittenText, '结论清楚。');
    assert.deepEqual(row.usage, { inputTokens: 10, outputTokens: 5 });
    assert.equal(row.stages?.length, 1);
    const a = f.adapter.calls.find(call => call.model === 'a')!;
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.ok(Object.isFrozen(a));
    assert.deepEqual(b.tools, []);
    assert.equal(f.adapter.calls.length, 2);
    // Inspect through the public derived history (the plugin itself never scans frozen requests).
    const history = f.agent.session.deriveMessages();
    const original = history.find(message => message.role === 'assistant')!;
    assert.deepEqual(original.content, [{ type: 'text', text: '原始的说明。' }]);
    assert.equal(original.source.kind, 'model');
    assert.deepEqual(original.source.replayState, { response: { native: 'source-replay' } });
    await f.prompt('按你的结论继续');
    await f.waitRow(row => row.turn === 2 && row.status === 'ready');
    const follow = f.adapter.calls.filter(call => call.model === 'a')[1];
    assert.equal(follow.messages.filter(message => JSON.stringify(message).includes('结论清楚。')).length, 1);
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 2, 'B must not wake an extra A step');
    assert.ok(f.agent.session.deriveMessages().some(message => message.source.kind === 'model-spokesperson'));
  } finally { await f.ctx.fiber.dispose(); }
});

test('C and same model at another provider bypass B', async () => {
  const f = await fixture(() => text('直接显示'));
  try {
    const c = await f.harness.create(SessionId('c'), { provider: 'mock', model: 'c' }, { cwd: process.cwd() });
    const other = await f.harness.create(SessionId('other'), { provider: 'other', model: 'a' }, { cwd: process.cwd() });
    for (const agent of [c, other]) {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] }));
      await agent.whenIdle();
      assert.deepEqual(f.ctx.sessionProjections.stateOf(agent.session, PROJECTION)?.rows, {});
    }
    assert.equal(f.adapter.calls.length, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('short question is edited; structured JSON and code-only artifacts bypass', async () => {
  for (const original of ['选方案一还是二？', '{"ready":true}', '```js\nconst a = 1;\n```']) {
    const f = await fixture(options => text(options.model === 'b' ? '要选方案一还是二？' : original));
    try {
      await f.prompt();
      if (original.endsWith('？')) { await f.waitRow(); assert.equal(f.adapter.calls.length, 2); }
      else { assert.equal(f.rows()[0].status, 'bypass'); assert.equal(f.adapter.calls.length, 1); }
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('writer failure modes fall back without repeating A', async () => {
  const failures: Generate[] = [
    async function* () { throw new Error('private endpoint details'); },
    () => text(''),
    async function* () { yield { type: 'text-delta', index: 0, text: '截断' }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; },
    async function* () { yield { type: 'tool-call-delta', index: 0, id: 'bad' as never, name: 'work', argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; },
  ];
  for (const failure of failures) {
    const f = await fixture(options => options.model === 'b' ? failure(options) : text('尚未验证，金额 10 元'));
    try {
      await f.prompt();
      const row = await f.waitRow(row => row.status === 'fallback');
      assert.equal(row.rewrittenText, undefined);
      assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
      assert.ok(!JSON.stringify(row).includes('private endpoint'));
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('B timeout and new input discard late results', async () => {
  const f = await fixture(options => options.model === 'b' ? (async function* () { await delay(150); yield* text('迟到稿'); })() : text('原文'), { timeoutMs: 20 });
  try {
    await f.prompt();
    assert.equal((await f.waitRow(row => row.status === 'fallback')).reason, 'timeout');
    await delay(180);
    assert.equal(f.rows()[0].status, 'fallback');
  } finally { await f.ctx.fiber.dispose(); }
});

test('tool path matches disabled baseline; only the following text report is edited', async () => {
  async function run(enabled: boolean) {
    let aCalls = 0;
    const f = await fixture(options => {
      if (options.model === 'b') return text('检查已经结束。');
      if (++aCalls > 1) return text('检查完毕。');
      return (async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: '开始检查' };
        yield { type: 'reasoning-delta', index: 1, text: '隐藏思考' };
        yield { type: 'tool-call-delta', index: 2, id: ToolCallId('call-1'), name: 'inspect', argumentsDelta: '{"path":"fixture.txt"}' };
        yield { type: 'text-delta', index: 3, text: '等待结果' };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      })();
    }, { enabled });
    const execution: unknown[] = [];
    f.ctx.tools.register({ name: 'inspect', description: 'Read a mock file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async args => { execution.push(args); return 'unchanged-result'; } });
    try {
      await f.prompt();
      if (enabled) {
        await f.waitRow();
        assert.equal(f.rows()[0].status, 'bypass');
        assert.equal(f.rows()[1].status, 'ready');
        const b = f.adapter.calls.find(call => call.model === 'b')!;
        assert.ok(!JSON.stringify(b.messages).includes('隐藏思考'));
        assert.ok(!JSON.stringify(b.messages).includes('unchanged-result'));
        assert.ok(JSON.stringify(b.messages).includes('检查完毕。'));
      }
      return { execution, aCalls, tools: f.agent.session.deriveMessages().filter(message => message.role === 'tool').map(message => message.content) };
    } finally { await f.ctx.fiber.dispose(); }
  }
  assert.deepEqual(await run(true), await run(false));
});

test('route switching, auxiliary calls, runtime children and B using A route', async () => {
  const f = await fixture(options => text(isAgentLoopRequest(options) ? '复杂说明' : '清楚说明'), {
    rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'a' } }],
  });
  try {
    let selected = 'a';
    await f.prompt(); await f.waitRow();
    selected = 'c'; f.agent.model.select({ provider: 'mock', model: selected }); await f.prompt();
    assert.equal(f.rows().length, 1);
    selected = 'a'; f.agent.model.select({ provider: 'mock', model: selected }); await f.prompt(); await f.waitRow(row => row.turn === 3 && row.status === 'ready');
    assert.equal(f.adapter.calls.length, 5);
    for await (const _ of f.ctx.llm.stream({ provider: 'mock', model: 'a', messages: [], purpose: 'session-title' })) {}
    const child = await f.ctx.agents.create({ sessionId: SessionId('child'), parentAgent: f.agent, meta: { origin: 'subagent' }, agentOptions: { provider: 'mock', model: 'a' } });
    child.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'internal' }] }));
    await child.agent.whenIdle();
    assert.deepEqual(f.ctx.sessionProjections.stateOf(child.agent.session, PROJECTION)?.rows, {});
    assert.equal(f.adapter.calls.length, 7);
  } finally { await f.ctx.fiber.dispose(); }
});

test('failed source attempt is never edited and retry has one final rewrite', async () => {
  let source = 0;
  const f = await fixture(options => options.model === 'b' ? text('清楚说明') : ++source === 1 ? (async function* (): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: '失败前缀' };
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEMPORARY', message: 'retry' } } };
  })() : text('完整说明'));
  try {
    f.ctx.on('agent/request-error', async () => ({ kind: 'retry' }));
    await f.prompt(); await f.waitRow();
    assert.equal(source, 2);
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, 1);
    assert.equal(f.rows()[0].originalText, '完整说明');
  } finally { await f.ctx.fiber.dispose(); }
});

test('new input cancels B; unload and re-enable do not regenerate historical rewrites', async () => {
  const f = await fixture(options => options.model === 'b' ? (async function* () { await delay(120); yield* text('迟到说明'); })() : text('原文'));
  try {
    await f.prompt();
    await f.prompt('新的输入');
    await f.waitRow(row => row.turn === 1 && row.status === 'cancelled');
    await f.fiber.dispose();
    assert.equal(f.ctx.sessionProjections.stateOf(f.agent.session, PROJECTION), undefined);
    const count = f.adapter.calls.length;
    const reloaded = await f.ctx.plugin(Host, { enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] });
    await delay(150);
    assert.equal(f.adapter.calls.length, count);
    assert.ok(f.agent.session.deriveMessages().some(message => message.role === 'assistant'));
    assert.ok(f.rows().every(row => row.status === 'cancelled' || row.status === 'fallback'));
    await reloaded.dispose();
  } finally { await f.ctx.fiber.dispose(); }
});

test('source truncation, cancellation and empty text never invoke B', async () => {
  for (const finish of ['max-tokens', 'aborted', 'stop'] as const) {
    const f = await fixture(() => (async function* (): AsyncIterable<StreamChunk> {
      if (finish !== 'stop') yield { type: 'text-delta', index: 0, text: '未完成' };
      yield { type: 'finish', reason: finish === 'aborted' ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancel' } } : { kind: finish } };
    })());
    try { await f.prompt(); assert.equal(f.adapter.calls.length, 1); assert.ok(f.rows().every(row => row.status === 'bypass')); }
    finally { await f.ctx.fiber.dispose(); }
  }
});

test('parallel sessions keep separate results and obey the shared rewrite limit', async () => {
  let active = 0, peak = 0;
  const f = await fixture(options => options.model === 'b' ? (async function* () {
    active++; peak = Math.max(peak, active);
    try {
      await delay(25);
      const input = (options.messages[0].content[0] as { text: string }).text;
      yield* text(input === '甲原文' ? '甲的说明' : '乙的说明');
    } finally { active--; }
  })() : text(JSON.stringify(options.messages).includes('甲') ? '甲原文' : '乙原文'), { maxConcurrentRewrites: 1 });
  try {
    const other = await f.harness.create(SessionId('parallel'), { provider: 'mock', model: 'a' }, { cwd: process.cwd() });
    other.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '乙' }] }));
    await Promise.all([f.prompt('甲'), other.whenIdle()]);
    const first = await f.waitRow();
    let second: Rewrite | undefined;
    for (let i = 0; i < 100; i++) {
      second = Object.values(f.ctx.sessionProjections.stateOf(other.session, PROJECTION)!.rows)[0];
      if (second?.status === 'ready') break;
      await delay(5);
    }
    assert.equal(peak, 1);
    assert.equal(first.rewrittenText, '甲的说明');
    assert.equal(second?.rewrittenText, '乙的说明');
    assert.notEqual(first.sessionId, second?.sessionId);
    assert.equal(f.adapter.calls.length, 4);
  } finally { await f.ctx.fiber.dispose(); }
});

test('fork inherits saved presentation without a new B request or changing raw messages', async () => {
  const f = await fixture(options => text(options.model === 'b' ? '清楚说明' : '原始说明'));
  try {
    await f.prompt();
    const saved = await f.waitRow();
    const fork = f.ctx.sessions.fork(f.agent.session);
    const projection = f.ctx.sessionProjections.stateOf(fork, PROJECTION)!;
    assert.equal(projection.rows['1:1'].rewrittenText, saved.rewrittenText);
    assert.equal(projection.rows['1:1'].originalMessageId, saved.originalMessageId);
    assert.equal(fork.deriveMessages().find(message => message.role === 'assistant')!.content[0].type, 'text');
    assert.ok(JSON.stringify(fork.deriveMessages()).includes('原始说明'));
    assert.equal(f.adapter.calls.length, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('turning future rewrites off still synchronizes already displayed history', async () => {
  const f = await fixture(options => text(options.model === 'b' ? '用户已经看到的说明' : '原始说明'));
  try {
    await f.prompt(); await f.waitRow();
    f.fiber.update({ enabled: false, rules: [{ source: {provider:'mock',model:'a'}, writer: {provider:'mock',model:'b'} }] });
    await f.fiber.await();
    await f.prompt('按你刚才的说明继续');
    const requests = f.adapter.calls.filter(call=>call.model === 'a');
    assert.equal(requests.length,2);
    assert.ok(JSON.stringify(requests[1].messages).includes('用户已经看到的说明'));
    assert.equal(f.adapter.calls.filter(call=>call.model === 'b').length,1);
  } finally { await f.ctx.fiber.dispose(); }
});

const systemOf = (options: GenerateOptions) => options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n');

const retryRequest = (row: Rewrite, sessionId = row.sessionId): RetryRequest => ({ sessionId, turn: row.turn, step: row.step, originalMessageId: row.originalMessageId!, attemptId: row.attemptId, retryCount: row.retryCount ?? 0 });

test('translation mode injects an English A rule and sends only the committed report to one B call', async () => {
  const cwd = process.cwd();
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('I added the “保存” button. Keyboard navigation still needs testing.');
    bCalls += 1;
    return text('已添加“保存”按钮。键盘导航还需要测试。');
  }, { translationWorkspaces: ['ws-1'], translationTarget: '中文' }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt('请做一个中文设置页');
    const row = await f.waitRow();
    assert.equal(row.policyVersion, 3);
    assert.equal(row.promptVersion, 3);
    assert.equal(row.translationTarget, '中文');
    assert.equal(row.originalText, 'I added the “保存” button. Keyboard navigation still needs testing.');
    assert.equal(row.rewrittenText, '已添加“保存”按钮。键盘导航还需要测试。');
    assert.equal(row.context, undefined);
    assert.deepEqual(row.stages?.map(stage => stage.kind), ['translate']);
    assert.equal(row.stages?.[0].input, row.originalText);
    assert.equal(bCalls, 1);
    const a = f.adapter.calls.find(call => call.model === 'a')!;
    assert.ok(systemOf(a).includes(ENGLISH_REPLY_RULE));
    assert.ok(systemOf(a).includes(TRANSLATION_MARKER));
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.deepEqual(b.tools, []);
    assert.ok(b.system?.includes(TRANSLATE_SYSTEM));
    assert.ok(b.system?.includes('目标语言：中文'));
    assert.ok(!b.system?.includes('表达偏好：'));
    assert.equal((b.messages[0].content[0] as { text: string }).text, row.originalText);
    const wire = JSON.stringify(b.messages);
    assert.ok(!wire.includes('userQuestion'));
    assert.ok(!wire.includes('workContext'));
  } finally { await f.ctx.fiber.dispose(); }
});

test('the editable English rule replaces the default A prompt and translation never appends the legacy style', async () => {
  const cwd = process.cwd();
  const custom = 'CUSTOM ENGLISH RULE: reply only in English even when the user writes Chinese.';
  const f = await fixture(options => text(options.model === 'b' ? '中文译文' : 'English report.'), {
    translationWorkspaces: ['ws-1'], englishPrompt: custom, style: 'SHOULD-NOT-REACH-B',
  }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt();
    await f.waitRow();
    const a = f.adapter.calls.find(call => call.model === 'a')!;
    assert.ok(systemOf(a).includes(custom));
    assert.ok(!systemOf(a).includes(ENGLISH_REPLY_RULE));
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.ok(!b.system?.includes('SHOULD-NOT-REACH-B'));
    assert.ok(!b.system?.includes('表达偏好：'));
  } finally { await f.ctx.fiber.dispose(); }
});

test('an inactive project uses A directly without an English rule or B requests', async () => {
  for (const translationWorkspaces of [[], ['other-ws']]) {
    const f = await fixture(() => text('A 直接回复'), { translationWorkspaces }, { cwd: process.cwd(), workspaceId: 'ws-2' });
    try {
      await f.prompt('请回复');
      assert.equal(f.rows().length, 0);
      assert.deepEqual(f.adapter.calls.map(call => call.model), ['a']);
      assert.ok(!systemOf(f.adapter.calls[0]).includes(TRANSLATION_MARKER));
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('disabling a project takes effect in the existing conversation and blocks translation retries', async () => {
  const f = await fixture(options => options.model === 'b' ? (async function* () { throw new Error('fail'); })() : text('A direct text'));
  try {
    await f.prompt();
    const failed = await f.waitRow(row => row.status === 'fallback');
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: [], reviewRounds: 9, style: 'OLD-STYLE-SENTINEL' });
    await f.fiber.await();
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(failed))).accepted, false);
    await f.prompt('继续');
    assert.deepEqual(f.adapter.calls.map(call => call.model), ['a', 'b', 'a']);
    assert.equal(f.rows().length, 1);
    assert.ok(!systemOf(f.adapter.calls.at(-1)!).includes(TRANSLATION_MARKER));
  } finally { await f.ctx.fiber.dispose(); }
});

test('a missing workspace service fails closed without resurrecting the legacy flow', async () => {
  const f = await fixture(() => text('A direct text'), { translationWorkspaces: ['ws-1'], reviewRounds: 9 });
  try {
    // Exercise the public service absence branch, independently of route matching.
    const get = f.ctx.get.bind(f.ctx);
    f.ctx.get = ((name: string) => name === 'workspaceRegistry' ? undefined : get(name)) as typeof f.ctx.get;
    await f.prompt();
    assert.deepEqual(f.adapter.calls.map(call => call.model), ['a']);
    assert.equal(f.rows().length, 0);
    assert.ok(!systemOf(f.adapter.calls[0]).includes(TRANSLATION_MARKER));
  } finally { await f.ctx.fiber.dispose(); }
});

test('saved legacy reports replay across reload without creating a new B request', async () => {
  const f = await fixture(options => text(options.model === 'b' ? '译文' : 'Original.'));
  try {
    await f.prompt();
    const row = await f.waitRow();
    appendPluginRecord(f.agent.session, RECORD, { ...row, policyVersion: 2, promptVersion: 2, rewrittenText: '旧版已保存的报告', reviewRounds: 1 });
    const before = f.adapter.calls.length;
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: [] });
    await f.fiber.await();
    assert.equal(f.rows()[0].rewrittenText, '旧版已保存的报告');
    assert.equal(f.adapter.calls.length, before);
    await f.prompt();
    assert.equal(f.adapter.calls.length, before + 1);
    assert.equal(f.rows().length, 1);
  } finally { await f.ctx.fiber.dispose(); }
});

test('an explicitly retried saved legacy failure remains compatible without enabling legacy generation', async () => {
  const f = await fixture(options => text(options.model === 'b' ? '旧报告已恢复' : 'Original.'), { translationWorkspaces: [] });
  try {
    await f.prompt('旧任务');
    assert.equal(f.rows().length, 0);
    const source = f.agent.session.deriveMessages().find(message => message.role === 'assistant')!;
    const legacy: Rewrite = { schemaVersion: 1, policyVersion: 2, promptVersion: 2, sessionId: f.agent.session.id,
      turn: 1, step: 1, attemptId: 'saved-legacy-attempt', source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' },
      originalMessageId: source.id, originalText: 'Original.', status: 'fallback', startedAt: Date.now(), reviewRounds: 1,
      context: { userQuestion: '旧任务', workContext: [{ role: 'user', source: 'user', content: [{ type: 'text', text: '旧任务' }] }] } };
    appendPluginRecord(f.agent.session, RECORD, legacy);
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(legacy))).accepted, true);
    const ready = await f.waitRow();
    assert.equal(ready.rewrittenText, '旧报告已恢复');
    assert.deepEqual(ready.stages?.map(stage => stage.kind), ['draft', 'review']);
    const before = f.adapter.calls.length;
    await f.prompt('新任务');
    assert.equal(f.adapter.calls.length, before + 1);
    assert.equal(f.rows().length, 1);
  } finally { await f.ctx.fiber.dispose(); }
});

test('tool-call steps bypass translation; the following text report is translated once', async () => {
  const cwd = process.cwd();
  let aCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'b') return text('检查已经结束。');
    if (++aCalls > 1) return text('The inspection is complete.');
    return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'Starting inspection' };
      yield { type: 'tool-call-delta', index: 1, id: ToolCallId('call-translate'), name: 'inspect', argumentsDelta: '{"path":"fixture.txt"}' };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    })();
  }, { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  f.ctx.tools.register({ name: 'inspect', description: 'Read a mock file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async () => 'unchanged-result' });
  try {
    await f.prompt();
    await f.waitRow();
    assert.equal(f.rows()[0].status, 'bypass');
    assert.equal(f.rows()[1].status, 'ready');
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, 1);
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.equal((b.messages[0].content[0] as { text: string }).text, 'The inspection is complete.');
    assert.ok(!JSON.stringify(b.messages).includes('unchanged-result'));
  } finally { await f.ctx.fiber.dispose(); }
});

test('a complete system-prompt preset suppresses the A rule, so no translation is attempted', async () => {
  const cwd = process.cwd();
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('English report.');
    bCalls += 1;
    return text('中文译文');
  }, { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  f.ctx.systemPrompt.section({ name: 'test:complete-prompt', order: 0, text: 'Complete prompt only.', complete: true });
  try {
    await f.prompt();
    const row = await f.waitRow(candidate => candidate.status === 'bypass');
    assert.equal(row.reason, 'translation-rule-missing');
    assert.equal(bCalls, 0);
  } finally { await f.ctx.fiber.dispose(); }
});

test('selecting C before a step bypasses translation and a later A step translates again', async () => {
  const cwd = process.cwd();
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'b') { bCalls += 1; return text('中文译文'); }
    return text('English report.');
  }, { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  try {
    f.agent.model.select({ provider: 'mock', model: 'c' });
    await f.prompt();
    assert.equal(f.rows().length, 0);
    assert.equal(bCalls, 0);
    const c = f.adapter.calls.find(call => call.model === 'c')!;
    assert.ok(!systemOf(c).includes(TRANSLATION_MARKER));
    f.agent.model.select({ provider: 'mock', model: 'a' });
    await f.prompt();
    const row = await f.waitRow();
    assert.equal(row.policyVersion, 3);
    assert.equal(bCalls, 1);
  } finally { await f.ctx.fiber.dispose(); }
});

test('translation retry calls B once with current translation settings and no work context', async () => {
  const cwd = process.cwd();
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('English report.');
    bCalls += 1;
    if (bCalls === 1) return (async function* () { throw new Error('temporary'); })();
    return text('中文译文');
  }, { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt();
    const failed = await f.waitRow(candidate => candidate.status === 'fallback');
    assert.equal(failed.policyVersion, 3);
    assert.ok(['writer-incomplete', 'writer-or-storage-error'].includes(failed.reason ?? ''));
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: ['ws-1'], translationPrompt: '新的翻译要求', translationTarget: '日文' });
    await f.fiber.await();
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(failed))).accepted, true);
    const ready = await f.waitRow(candidate => candidate.status === 'ready' && (candidate.retryCount ?? 0) === 1);
    assert.equal(ready.rewrittenText, '中文译文');
    assert.equal(ready.translationTarget, '日文');
    assert.equal(bCalls, 2);
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
    assert.deepEqual(ready.activeStages, [1]);
    assert.equal(ready.stages?.length, 2);
    assert.equal(ready.context, undefined);
    const lastB = f.adapter.calls.filter(call => call.model === 'b').at(-1)!;
    assert.ok(lastB.system?.startsWith('新的翻译要求'));
    assert.ok(lastB.system?.includes('目标语言：日文'));
    assert.equal((lastB.messages[0].content[0] as { text: string }).text, 'English report.');
  } finally { await f.ctx.fiber.dispose(); }
});

test('translation input budget is checked before B and retry can recover after raising it', async () => {
  const cwd = process.cwd();
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('English report with enough text to exceed a tiny translation budget.');
    bCalls += 1;
    return text('中文译文');
  }, { translationWorkspaces: ['ws-1'], maxInputChars: 20 }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt();
    const failed = await f.waitRow(candidate => candidate.status === 'fallback');
    assert.equal(failed.reason, 'input-limit');
    assert.equal(bCalls, 0);
    assert.ok((failed.inputBudget?.chars ?? 0) > 20);
    const blocked = await f.ctx.modelSpokesperson.retry(retryRequest(failed));
    assert.equal(blocked.accepted, false);
    if (!blocked.accepted) assert.ok(blocked.message.includes('超过设置上限'));
    assert.equal(f.rows()[0].retryCount, 0);
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: ['ws-1'], maxInputChars: 0 });
    await f.fiber.await();
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(failed))).accepted, true);
    const ready = await f.waitRow(candidate => candidate.status === 'ready');
    assert.equal(ready.rewrittenText, '中文译文');
    assert.equal(bCalls, 1);
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
  } finally { await f.ctx.fiber.dispose(); }
});

test('translation records recover only a completed staged translation', async () => {
  const cwd = process.cwd();
  const f = await fixture(options => text(options.model === 'b' ? '中文译文' : 'English report.'), { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt();
    const saved = await f.waitRow();
    appendPluginRecord(f.agent.session, RECORD, { ...saved, status: 'rewriting' });
    const count = f.adapter.calls.length;
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: ['ws-1'] });
    await f.fiber.await();
    assert.equal(f.rows()[0].status, 'ready');
    assert.equal(f.adapter.calls.length, count);
    const incomplete = { ...saved, status: 'rewriting' } as Rewrite;
    delete incomplete.rewrittenText;
    incomplete.stages = (saved.stages ?? []).map(stage => { const copy = { ...stage }; delete copy.output; delete copy.finishedAt; return copy; });
    appendPluginRecord(f.agent.session, RECORD, incomplete);
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], translationWorkspaces: ['ws-1'] });
    await f.fiber.await();
    assert.equal(f.rows()[0].status, 'fallback');
    assert.equal(f.rows()[0].reason, 'interrupted-rewrite');
  } finally { await f.ctx.fiber.dispose(); }
});

test('translation never sends a long work history to B', async () => {
  const cwd = process.cwd();
  const sentinel = 'UNIQUE-WORK-HISTORY-SENTINEL-7f3a';
  const f = await fixture(options => text(options.model === 'b' ? '第一句。第二句。' : 'First sentence. Second sentence.'), { translationWorkspaces: ['ws-1'] }, { cwd, workspaceId: 'ws-1' });
  try {
    await f.prompt('材'.repeat(540_000) + sentinel);
    const row = await f.waitRow();
    assert.equal(row.context, undefined);
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.equal((b.messages[0].content[0] as { text: string }).text, 'First sentence. Second sentence.');
    assert.ok(!JSON.stringify(b.messages).includes(sentinel));
    assert.ok(JSON.stringify(b.messages).length < 2_000);
  } finally { await f.ctx.fiber.dispose(); }
});

test('busy A and disabled plugin reject retries before making any B request', async () => {
  let notify!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { notify = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sourceCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'b') return (async function* () { throw new Error('fail'); })();
    if (++sourceCalls === 1) return text('A 原文');
    return (async function* () { notify(); await gate; yield* text('A 后续工作'); })();
  });
  try {
    await f.prompt();
    const failed = await f.waitRow(row => row.status === 'fallback');
    const pending = f.prompt('A 新任务'); await started;
    const before = f.adapter.calls.filter(call => call.model === 'b').length;
    const busy = await f.ctx.modelSpokesperson.retry(retryRequest(failed));
    assert.equal(busy.accepted, false);
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, before);
    f.agent.cancel({ kind: 'user' }); release(); await pending;
    f.fiber.update({ enabled: false, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] }); await f.fiber.await();
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(failed))).accepted, false);
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, before);
  } finally { release(); await f.ctx.fiber.dispose(); }
});
