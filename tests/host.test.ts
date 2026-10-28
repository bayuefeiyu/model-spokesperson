import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit';
import { LlmAdapter, createUserMessage, ToolCallId, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as Host from '../src/host.ts';
import { PROJECTION, type Settings, type Rewrite } from '../src/contract.ts';

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
export async function fixture(generate: Generate, overrides: Partial<Settings> = {}) {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  provideWorkingDirectoryFixture(ctx, process.cwd() + '/.dev/workspace');
  const adapter = new MockAdapter(generate);
  ctx.llm.registerAdapter(['mock', 'other'], adapter);
  const fiber = await ctx.plugin(Host, { enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }], ...overrides });
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('test-' + crypto.randomUUID()), { provider: 'mock', model: 'a' });
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
    const c = await f.harness.create(SessionId('c'), { provider: 'mock', model: 'c' });
    const other = await f.harness.create(SessionId('other'), { provider: 'other', model: 'a' });
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
    () => text('已经验证，金额 12 元'),
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
    f.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: selected }));
    await f.prompt(); await f.waitRow();
    selected = 'c'; await f.prompt();
    assert.equal(f.rows().length, 1);
    selected = 'a'; await f.prompt(); await f.waitRow(row => row.turn === 3 && row.status === 'ready');
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
      const input = JSON.parse((options.messages[0].content[0] as { text: string }).text);
      yield* text(input.userQuestion === '甲' ? '甲的说明' : '乙的说明');
    } finally { active--; }
  })() : text('原始说明'), { maxConcurrentRewrites: 1 });
  try {
    const other = await f.harness.create(SessionId('parallel'), { provider: 'mock', model: 'a' });
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
