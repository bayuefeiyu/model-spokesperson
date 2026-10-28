import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit';
import { LlmAdapter, createUserMessage, ToolCallId, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session';
import * as Host from '../src/host.ts';
import { PROJECTION, RECORD, type RetryRequest, type Settings, type Rewrite } from '../src/contract.ts';

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
    assert.deepEqual(row.usage, { inputTokens: 20, outputTokens: 10 });
    assert.equal(row.stages?.length, 2);
    const a = f.adapter.calls.find(call => call.model === 'a')!;
    const b = f.adapter.calls.find(call => call.model === 'b')!;
    assert.ok(Object.isFrozen(a));
    assert.deepEqual(b.tools, []);
    assert.equal(f.adapter.calls.length, 3);
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
      if (original.endsWith('？')) { await f.waitRow(); assert.equal(f.adapter.calls.length, 3); }
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
        assert.ok(JSON.stringify(b.messages).includes('unchanged-result'));
        assert.ok(!JSON.stringify(b.messages).includes('检查完毕。'));
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
    assert.equal(f.adapter.calls.length, 7);
    for await (const _ of f.ctx.llm.stream({ provider: 'mock', model: 'a', messages: [], purpose: 'session-title' })) {}
    const child = await f.ctx.agents.create({ sessionId: SessionId('child'), parentAgent: f.agent, meta: { origin: 'subagent' }, agentOptions: { provider: 'mock', model: 'a' } });
    child.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'internal' }] }));
    await child.agent.whenIdle();
    assert.deepEqual(f.ctx.sessionProjections.stateOf(child.agent.session, PROJECTION)?.rows, {});
    assert.equal(f.adapter.calls.length, 9);
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
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, 2);
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
    assert.equal(f.adapter.calls.length, 6);
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
    assert.equal(f.adapter.calls.length, 3);
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
    assert.equal(f.adapter.calls.filter(call=>call.model === 'b').length,2);
  } finally { await f.ctx.fiber.dispose(); }
});

const inputOf = (options: GenerateOptions) => JSON.parse((options.messages[0].content[0] as { text: string }).text);

test('B drafts from pre-report evidence, then improves its own draft using A only as a reference', async () => {
  const sourceReport = 'A 的模板成稿：先写冗长背景。测试尚未验证。';
  const draft = 'B 自己的结构：这是一个项目分析结果。';
  const final = 'B 自己的结构：这是一个项目分析结果。测试尚未验证。';
  let aCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'b') return text(inputOf(options).ownDraft ? final : draft);
    if (++aCalls > 1) return text(sourceReport);
    return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'reasoning-delta', index: 0, text: '不能转交的内部思考' };
      yield { type: 'tool-call-delta', index: 1, id: ToolCallId('read-project'), name: 'inspect', argumentsDelta: '{"path":"project.json"}' };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    })();
  });
  f.ctx.tools.register({ name: 'inspect', description: 'Read project evidence', parameters: { type: 'object', properties: { path: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async () => '文件实际内容：项目采用 TypeScript；没有运行测试。' });
  try {
    await f.prompt('分析这个项目，说明实际依据和未验证事项');
    const row = await f.waitRow();
    const calls = f.adapter.calls.filter(call => call.model === 'b');
    assert.equal(calls.length, 2);
    const first = inputOf(calls[0]), review = inputOf(calls[1]);
    assert.equal(first.userQuestion, '分析这个项目，说明实际依据和未验证事项');
    assert.ok(JSON.stringify(first.workContext).includes('项目采用 TypeScript'));
    assert.ok(JSON.stringify(first.workContext).includes('project.json'));
    assert.ok(!JSON.stringify(first).includes(sourceReport));
    assert.ok(!JSON.stringify(first).includes('不能转交的内部思考'));
    assert.equal(first.sourceReport, undefined);
    assert.equal(first.originalText, undefined);
    assert.equal(review.ownDraft, draft);
    assert.equal(review.sourceReport, sourceReport);
    assert.deepEqual(review.workContext, first.workContext);
    assert.match(calls[1].system!, /必须基于自己的 ownDraft 进行完善/);
    assert.match(calls[1].system!, /发生矛盾时优先核查 workContext/);
    assert.equal(row.rewrittenText, final);
    assert.equal(row.originalText, sourceReport);
    assert.deepEqual(row.stages?.map(stage => stage.output), [draft, final]);
    assert.deepEqual(row.stages?.map(stage => stage.kind), ['draft', 'review']);
    assert.deepEqual(row.usage, { inputTokens: 20, outputTokens: 10 });
    // New report structure and ordering are no longer constrained by A's draft.
    assert.equal(row.policyVersion, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('multiple reviews always improve B previous output; zero reviews never disclose A report', async () => {
  for (const reviewRounds of [0, 3]) {
    const ownReports: string[] = [];
    const f = await fixture(options => {
      if (options.model === 'a') return text('A 本次报告，绝不作为独立起草的输入');
      const input = inputOf(options);
      const result = input.ownDraft ? `${input.ownDraft}，第 ${input.reviewRound} 轮补充` : 'B 独立起草';
      ownReports.push(result);
      return text(result);
    }, { reviewRounds });
    try {
      await f.prompt();
      const row = await f.waitRow();
      const calls = f.adapter.calls.filter(call => call.model === 'b');
      assert.equal(calls.length, reviewRounds + 1);
      assert.ok(!JSON.stringify(inputOf(calls[0])).includes('A 本次报告'));
      for (let i = 1; i < calls.length; i++) assert.equal(inputOf(calls[i]).ownDraft, ownReports[i - 1]);
      assert.equal(row.rewrittenText, ownReports.at(-1));
      assert.equal(row.stages?.length, reviewRounds + 1);
      assert.deepEqual(row.usage, { inputTokens: 10 * calls.length, outputTokens: 5 * calls.length });
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('failed review never publishes the unchecked draft or reruns A', async () => {
  for (const failure of ['empty', 'error', 'truncated', 'tools']) {
    const f = await fixture(options => {
      if (options.model === 'a') return text('A 的回退原文');
      if (!inputOf(options).ownDraft) return text('尚未核对的 B 初稿');
      return (async function* (): AsyncIterable<StreamChunk> {
        if (failure === 'error') throw new Error('secret provider endpoint');
        if (failure === 'tools') yield { type: 'tool-call-delta', index: 0, id: ToolCallId('forbidden'), name: 'work', argumentsDelta: '{}' };
        else yield { type: 'text-delta', index: 0, text: failure === 'empty' ? '' : '截断的核对稿' };
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } };
        yield { type: 'finish', reason: { kind: failure === 'tools' ? 'tool-calls' : failure === 'truncated' ? 'max-tokens' : 'stop' } };
      })();
    });
    try {
      await f.prompt();
      const row = await f.waitRow(row => row.status === 'fallback');
      assert.equal(row.rewrittenText, undefined);
      assert.equal(row.stages?.[0].output, '尚未核对的 B 初稿');
      assert.equal(row.stages?.[1].output, undefined);
      assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
      assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, 2);
      assert.ok(!JSON.stringify(row).includes('secret provider endpoint'));
      if (failure !== 'error') assert.deepEqual(row.usage, { inputTokens: 13, outputTokens: 7 });
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('new input during review cancels remaining rounds and discards late review output', async () => {
  let notifyReview!: () => void;
  const reviewStarted = new Promise<void>(resolve => { notifyReview = resolve; });
  const f = await fixture(options => {
    if (options.model === 'a') return text('A 的报告');
    const input = inputOf(options);
    if (input.userQuestion === '第一轮' && input.ownDraft) return (async function* () {
      notifyReview(); await delay(120); yield* text('迟到的核对稿');
    })();
    return text(input.ownDraft ?? 'B 的初稿');
  }, { reviewRounds: 3 });
  try {
    await f.prompt('第一轮'); await reviewStarted;
    await f.prompt('新的用户问题');
    const cancelled = await f.waitRow(row => row.turn === 1 && row.status === 'cancelled');
    assert.equal(cancelled.rewrittenText, undefined);
    await f.waitRow(row => row.turn === 2 && row.status === 'ready');
    await delay(150);
    assert.equal(f.rows().find(row => row.turn === 1)?.status, 'cancelled');
    assert.equal(f.adapter.calls.filter(call => call.model === 'b' && inputOf(call).userQuestion === '第一轮').length, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('large work context and user output budget are accepted without the old physical caps', async () => {
  const question = '项目材料'.repeat(260_001);
  const f = await fixture(options => text(options.model === 'a' ? 'A 的报告' : 'B 的报告'), { reviewRounds: 0, maxOutputTokens: 100_000 });
  try {
    await f.prompt(question);
    const row = await f.waitRow();
    const call = f.adapter.calls.find(call => call.model === 'b')!;
    assert.equal(inputOf(call).userQuestion.length, question.length);
    assert.equal(call.maxTokens, 100_000);
    assert.ok(row.stages![0].input.length > 1_000_000);
  } finally { await f.ctx.fiber.dispose(); }
});

test('user input budget is checked per review without silently truncating either report', async () => {
  const f = await fixture(options => text(options.model === 'a' ? '长'.repeat(10_000) : 'B 的短初稿'), { maxInputChars: 6_000 });
  try {
    await f.prompt();
    const row = await f.waitRow(row => row.status === 'fallback');
    assert.equal(row.reason, 'input-limit');
    assert.equal(row.stages?.length, 1, 'draft fits; review would exceed user budget');
    assert.equal(f.adapter.calls.filter(call => call.model === 'b').length, 1);
    assert.equal(row.originalText?.length, 10_000);
  } finally { await f.ctx.fiber.dispose(); }
});

test('recovery accepts only a completed staged final report and never reruns incomplete reviews', async () => {
  const f = await fixture(options => text(options.model === 'a' ? 'A 原文' : 'B 最终正文'));
  try {
    await f.prompt();
    const saved = await f.waitRow();
    const count = f.adapter.calls.length;
    for (const complete of [true, false]) {
      appendPluginRecord(f.agent.session, RECORD, { ...saved, status: 'rewriting', stages: complete ? saved.stages! : saved.stages!.slice(0, 1) });
      f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] });
      await f.fiber.await();
      assert.equal(f.rows()[0].status, complete ? 'ready' : 'fallback');
      if (!complete) assert.equal(f.rows()[0].rewrittenText, undefined);
      assert.equal(f.adapter.calls.length, count);
    }
    // Legacy v1 records continue to recover under their original guard policy.
    appendPluginRecord(f.agent.session, RECORD, { ...saved, status: 'rewriting', policyVersion: 1, promptVersion: 1 });
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] });
    await f.fiber.await();
    assert.equal(f.rows()[0].status, 'ready');
    assert.equal(f.adapter.calls.length, count);
  } finally { await f.ctx.fiber.dispose(); }
});

test('custom stage prompts replace complete defaults and are recorded exactly with the chosen style', async () => {
  const draftPrompt = '我的起草提示词\n按我的结构写。';
  const reviewPrompt = '我的核对提示词\n只完善自己的上一稿。';
  const style = '我的表达偏好';
  const f = await fixture(options => text(options.model === 'a' ? 'A 参考报告' : 'B 正文'), { draftPrompt, reviewPrompt, style });
  try {
    await f.prompt();
    const row = await f.waitRow();
    const calls = f.adapter.calls.filter(call => call.model === 'b');
    assert.deepEqual(calls.map(call => call.system), [draftPrompt + '\n表达偏好：' + style, reviewPrompt + '\n表达偏好：' + style]);
    assert.deepEqual(row.stages?.map(stage => stage.system), calls.map(call => call.system));
    assert.equal(inputOf(calls[0]).sourceReport, undefined);
    assert.equal(inputOf(calls[1]).sourceReport, 'A 参考报告');
  } finally { await f.ctx.fiber.dispose(); }
});

const retryRequest = (row: Rewrite, sessionId = row.sessionId): RetryRequest => ({ sessionId, turn: row.turn, step: row.step, originalMessageId: row.originalMessageId!, attemptId: row.attemptId, retryCount: row.retryCount ?? 0 });

test('manual retry after draft failure calls only B and preserves the exact original work snapshot', async () => {
  let bCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('A 本次成稿');
    if (++bCalls === 1) return (async function* () { throw new Error('temporary endpoint failure'); })();
    return text('B 最终稿');
  });
  try {
    await f.prompt('原来的任务');
    const failed = await f.waitRow(row => row.status === 'fallback');
    assert.deepEqual(await f.ctx.modelSpokesperson.retry(retryRequest(failed)), { accepted: true });
    const ready = await f.waitRow();
    assert.equal(ready.retryCount, 1);
    assert.equal(bCalls, 3);
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
    const bs = f.adapter.calls.filter(call => call.model === 'b');
    assert.deepEqual(inputOf(bs[0]), inputOf(bs[1]));
    assert.ok(!JSON.stringify(inputOf(bs[1])).includes('A 本次成稿'));
    assert.deepEqual(ready.activeStages, [1, 2]);
    assert.equal(ready.stages?.length, 3);
    assert.deepEqual(await f.ctx.modelSpokesperson.retry(retryRequest(failed)), { accepted: false, message: '这条回复的状态已改变，请刷新后再试。' });
  } finally { await f.ctx.fiber.dispose(); }
});

test('review retries reuse successful draft, keep failed calls/usage and recover complete final history', async () => {
  let reviewCalls = 0;
  const f = await fixture(options => {
    if (options.model === 'a') return text('A 原文');
    if (!inputOf(options).ownDraft) return text('B 已成功的初稿');
    if (++reviewCalls <= 2) return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } };
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEMPORARY', message: 'private endpoint' } } };
    })();
    return text('B 核对后的稿件');
  });
  try {
    await f.prompt();
    let row = await f.waitRow(row => row.status === 'fallback');
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(row))).accepted, true);
    row = await f.waitRow(row => row.status === 'fallback' && row.retryCount === 1);
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(row))).accepted, true);
    const ready = await f.waitRow();
    assert.equal(ready.rewrittenText, 'B 核对后的稿件');
    assert.equal(ready.retryCount, 2);
    assert.deepEqual(ready.activeStages, [0, 3]);
    assert.equal(ready.stages?.length, 4);
    assert.deepEqual(ready.usage, { inputTokens: 26, outputTokens: 14 });
    assert.equal(f.adapter.calls.filter(call => call.model === 'b' && !inputOf(call).ownDraft).length, 1);
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
    const count = f.adapter.calls.length;
    appendPluginRecord(f.agent.session, RECORD, { ...ready, status: 'rewriting' });
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] }); await f.fiber.await();
    assert.equal(f.rows()[0].status, 'ready');
    assert.equal(f.adapter.calls.length, count);
  } finally { await f.ctx.fiber.dispose(); }
});

test('retry uses current prompts/budgets and invalidates successful prefix when draft requirements change', async () => {
  for (const change of ['review', 'draft', 'writer']) {
    let fail = true;
    const f = await fixture(options => {
      if (options.model === 'a') return text('A 原文');
      if (inputOf(options).ownDraft && fail) return (async function* () { throw new Error('fail'); })();
      return text('B 正文');
    });
    try {
      await f.prompt();
      const failed = await f.waitRow(row => row.status === 'fallback');
      fail = false;
      const writer = { provider: 'mock', model: change === 'writer' ? 'b-new' : 'b' };
      f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer }], maxOutputTokens: 100000,
        ...(change === 'review' ? { reviewPrompt: '新的核对要求' } : change === 'draft' ? { draftPrompt: '新的起草要求' } : {}) });
      await f.fiber.await();
      const before = f.adapter.calls.length;
      assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(failed))).accepted, true);
      const ready = await f.waitRow();
      const newCalls = f.adapter.calls.slice(before);
      assert.equal(newCalls.length, change === 'review' ? 1 : 2);
      assert.ok(newCalls.every(call => call.maxTokens === 100000 && call.model === writer.model));
      if (change === 'review') assert.ok(newCalls[0].system?.startsWith('新的核对要求'));
      else assert.equal(inputOf(newCalls[0]).ownDraft, undefined);
      assert.equal(ready.retryCount, 1);
      assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 1);
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('retry admission rejects duplicate clicks and new input cancels only the B retry maintenance task', async () => {
  let fail = true, retryStarted!: () => void;
  const started = new Promise<void>(resolve => { retryStarted = resolve; });
  const f = await fixture(options => {
    if (options.model === 'a') return text('A 原文');
    if (fail) return (async function* () { throw new Error('fail'); })();
    if (inputOf(options).userQuestion === '旧问题') return (async function* () { retryStarted(); await delay(80); yield* text('迟到的 B'); })();
    return text('新问题 B');
  });
  try {
    await f.prompt('旧问题');
    const failed = await f.waitRow(row => row.status === 'fallback');
    fail = false;
    const req = retryRequest(failed);
    assert.equal((await f.ctx.modelSpokesperson.retry(req)).accepted, true);
    await started;
    assert.equal((await f.ctx.modelSpokesperson.retry(req)).accepted, false);
    await f.prompt('新问题');
    const cancelled = f.rows().find(row => row.turn === 1)!;
    assert.equal(cancelled.status, 'cancelled');
    await f.waitRow(row => row.turn === 2 && row.status === 'ready');
    await delay(100);
    assert.equal(f.rows().find(row => row.turn === 1)?.status, 'cancelled');
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 2);
    assert.equal(f.adapter.calls.filter(call => call.model === 'b' && inputOf(call).userQuestion === '旧问题').length, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('legacy pre-call failures reconstruct only history before their original report', async () => {
  const f = await fixture(options => text(options.model === 'a' ? 'A 原文' : 'B 正文'), { maxInputChars: 1 });
  try {
    await f.prompt('早期用户要求');
    const failed = await f.waitRow(row => row.status === 'fallback');
    const legacy = { ...failed }; delete legacy.context; delete legacy.activeStages;
    appendPluginRecord(f.agent.session, RECORD, legacy);
    await f.prompt('后来的新要求');
    await f.waitRow(row => row.turn === 2 && row.status === 'fallback');
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] }); await f.fiber.await();
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(legacy))).accepted, true);
    await f.waitRow(row => row.turn === 1 && row.status === 'ready');
    const firstB = f.adapter.calls.find(call => call.model === 'b')!;
    assert.equal(inputOf(firstB).userQuestion, '早期用户要求');
    assert.ok(!JSON.stringify(inputOf(firstB)).includes('后来的新要求'));
    assert.equal(f.adapter.calls.filter(call => call.model === 'a').length, 2);
  } finally { await f.ctx.fiber.dispose(); }
});

test('a pre-0.2.2 review failure resumes from its stored first request after Host reload', async () => {
  let fail = true;
  const f = await fixture(options => {
    if (options.model === 'a') return text('A 原文');
    if (inputOf(options).ownDraft && fail) return (async function* () { throw new Error('temporary'); })();
    return text('B 正文');
  });
  try {
    await f.prompt('老版本的任务');
    const failed = await f.waitRow(row => row.status === 'fallback');
    const legacy = { ...failed, stages: failed.stages!.map(stage => { const copy = { ...stage }; delete copy.writer; return copy; }) };
    delete legacy.context; delete legacy.activeStages; delete legacy.retryCount;
    appendPluginRecord(f.agent.session, RECORD, legacy);
    f.fiber.update({ enabled: true, rules: [{ source: { provider: 'mock', model: 'a' }, writer: { provider: 'mock', model: 'b' } }] }); await f.fiber.await();
    fail = false;
    const before = f.adapter.calls.length;
    assert.equal((await f.ctx.modelSpokesperson.retry(retryRequest(legacy))).accepted, true);
    await f.waitRow();
    const calls = f.adapter.calls.slice(before);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'b');
    assert.equal(inputOf(calls[0]).ownDraft, 'B 正文');
    assert.equal(inputOf(calls[0]).userQuestion, '老版本的任务');
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
