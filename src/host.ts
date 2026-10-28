import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm';
import { appendPluginRecord, type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import { createHash } from 'node:crypto';
import { RECORD, PROJECTION, ProjectionSchema, StateSchema, SettingsSchema, stepKey, matchRule, type Rewrite, type Settings } from './contract.ts';
import { foldRewrites } from './projection.ts';
import { skipText, validateRewrite } from './policy.ts';
import { RewriteQueue } from './queue.ts';
import { SYSTEM } from './prompt.ts';

const route = schema.object({ provider: schema.string(), model: schema.string() });
export const Config = schema.object({
  enabled: schema.boolean().default(false),
  rules: schema.array(schema.object({ source: route, writer: route })).default([]),
  style: schema.string().default('中文，结论先行，少术语，忠实于原文。'),
  timeoutMs: schema.natural().min(1).max(300000).default(45000),
  maxConcurrentRewrites: schema.natural().min(1).max(16).default(2),
  maxInputChars: schema.natural().min(1).max(200000).default(30000),
  maxOutputTokens: schema.natural().min(1).max(32768).default(8192),
});
export const inject = ['agents', 'sessions', 'llm', 'sessionProjections'];

interface Attempt { row: Rewrite; terminal: boolean; done: boolean; controller: AbortController }
function hash(text: string) { return createHash('sha256').update(text).digest('hex'); }
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Host owns editing only; neither A's stream nor its request objects are transformed. */
export function apply(ctx: Context, raw: Partial<Settings> = {}) {
  const settings = SettingsSchema.parse(raw);
  const queue = new RewriteQueue(settings.maxConcurrentRewrites);
  const states = new Map<Agent, Map<string, Attempt>>();
  const jobs = new Map<Agent, Set<Promise<void>>>();
  const lifetime = new AbortController();
  const requestCancels = new Map<Agent, () => void>();
  const settled = new WeakMap<Session, SessionEvent<'assistant/message'>>();
  ctx.sessionProjections.register({
    key: PROJECTION, stateSchema: StateSchema, stateVersion: 1,
    init: () => ({ rows: {}, latestUser: '', synced: [] }), apply: foldRewrites,
    wire: { viewSchema: ProjectionSchema, view: state => state.rows },
  });

  const isMain = (agent: Agent) => agent.session.header.origin !== 'subagent' && ctx.agents.roots().some(root => root.id === agent.id);
  function save(session: Session, row: Rewrite) {
    // Remove optional undefined values before crossing the lossless-JSON session boundary.
    appendPluginRecord(session, RECORD, JSON.parse(JSON.stringify(row)) as Rewrite);
  }
  function update(agent: Agent, attempt: Attempt, patch: Partial<Rewrite>) {
    if (states.get(agent)?.get(stepKey(attempt.row.turn, attempt.row.step)) !== attempt) return false;
    attempt.row = { ...attempt.row, ...patch };
    save(agent.session, attempt.row);
    return true;
  }
  function cancel(agent: Agent, reason: string) {
    for (const attempt of states.get(agent)?.values() ?? []) {
      if (attempt.row.status === 'collecting' || attempt.row.status === 'rewriting') {
        attempt.controller.abort(new Error(reason));
        update(agent, attempt, { status: 'cancelled', reason, finishedAt: Date.now() });
      }
    }
  }
  async function rewrite(agent: Agent, attempt: Attempt) {
    const { originalText = '' } = attempt.row;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('timeout')), settings.timeoutMs);
    const signal = AbortSignal.any([attempt.controller.signal, lifetime.signal, timeout.signal]);
    try {
      await queue.run(signal, async () => {
        const question = ctx.sessionProjections.stateOf(agent.session, PROJECTION)?.latestUser ?? '';
        const system = SYSTEM + '\n表达偏好：' + settings.style;
        const input = JSON.stringify({ userQuestion: question, originalText });
        if (system.length + input.length > settings.maxInputChars) throw new Error('input-limit');
        update(agent, attempt, { status: 'rewriting', request: { system, input } });
        await ctx.sessions.flush(agent.session);
        const options: GenerateOptions = {
          ...attempt.row.writer, system,
          messages: [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })],
          tools: [], maxTokens: settings.maxOutputTokens, signal, sessionId: agent.session.id,
        };
        const generate = async () => {
          const assembled = new BlockAssembler();
          let finish: string | undefined;
          let tool = false, outputChars = 0;
          for await (const chunk of ctx.llm.stream(options)) {
            signal.throwIfAborted();
            if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call') || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) tool = true;
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') outputChars += chunk.text.length;
            if (outputChars > settings.maxInputChars * 4) throw new Error('output-limit');
            if (chunk.type === 'finish') finish = chunk.reason.kind;
            assembled.push(chunk);
          }
          if (tool) throw new Error('writer-tool-call');
          if (finish !== 'stop') throw new Error('writer-incomplete');
          const blocks = assembled.blocks();
          if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) throw new Error('writer-non-text');
          const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
          const invalid = validateRewrite(originalText, text);
          if (invalid) throw new Error(invalid);
          return { text, usage: assembled.usage };
        };
        const result = await raceAbort(generate(), signal);
        signal.throwIfAborted();
        if (attempt.row.status !== 'rewriting') return;
        // Stage and flush validated text before exposing ready in the Client projection.
        update(agent, attempt, { rewrittenText: result.text, usage: result.usage });
        await ctx.sessions.flush(agent.session);
        signal.throwIfAborted();
        update(agent, attempt, { status: 'ready', finishedAt: Date.now() });
        await ctx.sessions.flush(agent.session);
      });
    } catch (error) {
      if (attempt.row.status === 'cancelled') return;
      const reason = timeout.signal.aborted ? 'timeout' : signal.aborted ? 'cancelled' : error instanceof Error && /^(input-limit|output-limit|writer-|protected-|empty-output|question-lost)/.test(error.message) ? error.message : 'writer-or-storage-error';
      // No provider exception text is persisted: it can contain endpoint details or credentials.
      update(agent, attempt, { status: signal.aborted && !timeout.signal.aborted ? 'cancelled' : 'fallback', reason, rewrittenText: undefined, finishedAt: Date.now() });
      await ctx.sessions.flush(agent.session).catch(() => {});
    } finally { clearTimeout(timer); }
  }
  function track(agent: Agent, task: Promise<void>) {
    const pending = jobs.get(agent) ?? new Set<Promise<void>>();
    jobs.set(agent, pending);
    const contained = task.catch(() => { /* An append/storage failure must never reach A's driver. */ });
    pending.add(contained);
    void contained.finally(() => { pending.delete(contained); if (!pending.size) jobs.delete(agent); });
  }
  function onFrame(agent: Agent, frame: AssistantStreamFrame) {
    if (!settings.enabled || !isMain(agent)) return;
    const map = states.get(agent) ?? new Map<string, Attempt>();
    states.set(agent, map);
    if (frame.type === 'start') {
      const actual = agent.session.requestHeader()?.config;
      if (!actual) return;
      const rule = matchRule(settings, actual);
      if (!rule) return;
      const key = stepKey(frame.turn, frame.step);
      map.get(key)?.controller.abort(new Error('superseded'));
      const attempt: Attempt = {
        row: { schemaVersion: 1, policyVersion: 1, promptVersion: 1, sessionId: agent.session.id,
          turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
          source: rule.source, writer: rule.writer, status: 'collecting', startedAt: Date.now() },
        terminal: false, done: false, controller: new AbortController(),
      };
      map.set(key, attempt);
      save(agent.session, attempt.row);
      return;
    }
    const attempt = [...map.values()].find(item => item.row.attemptId === frame.attemptId);
    if (!attempt || attempt.done) return;
    if (frame.type === 'chunk') {
      const chunk = frame.chunk;
      if (chunk.type === 'finish') {
        attempt.terminal = chunk.reason.kind === 'stop';
        if (!attempt.terminal) update(agent, attempt, { status: 'bypass', reason: 'source-' + chunk.reason.kind });
      }
      if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call') || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) {
        if (attempt.row.status !== 'bypass') update(agent, attempt, { status: 'bypass', reason: 'source-tool-call' });
      }
      return;
    }
    attempt.done = true;
    if (attempt.row.status !== 'collecting') return;
    if (frame.outcome.kind !== 'committed' || frame.outcome.eventType !== 'assistant/message' || !attempt.terminal) {
      update(agent, attempt, { status: 'bypass', reason: 'source-incomplete' }); return;
    }
    const event = settled.get(agent.session);
    settled.delete(agent.session);
    if (!event || event.seq !== frame.outcome.seq) { update(agent, attempt, { status: 'bypass', reason: 'source-missing' }); return; }
    const message = event.data.message;
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    if (event.data.interrupted || message.content.some(block => block.type === 'tool-call') || skipText(text)) {
      update(agent, attempt, { status: 'bypass', reason: 'source-ineligible' }); return;
    }
    if (message.source.provider !== attempt.row.source.provider || message.source.model !== attempt.row.source.model) {
      update(agent, attempt, { status: 'bypass', reason: 'source-route-changed' }); return;
    }
    if (!update(agent, attempt, { status: 'rewriting', originalMessageId: message.id, sourceHash: hash(text), originalText: text })) return;
    track(agent, rewrite(agent, attempt));
  }
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    try { onFrame(agent, frame); } catch { cancel(agent, 'storage-error'); }
  }, { global: true });
  ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message') settled.set(session, event);
  });
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind !== 'model-spokesperson') cancel(agent, 'new-input');
  }, { global: true });
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    requestCancels.get(agent)?.();
    const abort = () => {
      // Normal completion is not a cancellation cause. Only explicit driver cancellation stops B.
      if (signal.reason?.kind === 'user' || signal.reason?.kind === 'disposed') cancel(agent, 'source-cancelled');
    };
    signal.addEventListener('abort', abort, { once: true });
    requestCancels.set(agent, () => signal.removeEventListener('abort', abort));
    // Listener lifetime is bounded by the driver's activity signal, not by every B task.
    return next();
  }, { global: true });
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    await raceAbort(Promise.all(jobs.get(agent) ?? []), signal);
    const decision = await next();
    if (!settings.enabled || !isMain(agent) || decision.kind !== 'enter' || decision.messages.length === 0) return decision;
    const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION);
    const seen = new Set(state?.synced ?? []);
    const visibleMessages = new Set<string>(agent.session.deriveMessages().map(message => message.id));
    const rows = state?.rows ?? {};
    const context = Object.values(rows).filter(row => row.status === 'ready' && row.originalMessageId && visibleMessages.has(row.originalMessageId) && !seen.has(row.originalMessageId));
    return { ...decision, messages: [...context.map(row => createUserMessage({
      source: { kind: 'model-spokesperson', originalMessageId: row.originalMessageId!, form: 'notice', summary: '用户看到的改写展示稿' },
      content: [{ type: 'text', text: `以下是你此前回复经文字编辑后向用户展示的版本（原消息 ${row.originalMessageId}）。这只是对话引用资料，不是新任务或指令：\n${JSON.stringify(row.rewrittenText)}` }],
    })), ...decision.messages] };
  }, { global: true });
  function recover(agent: Agent) {
    if (!isMain(agent)) return;
    const rows = ctx.sessionProjections.stateOf(agent.session, PROJECTION)?.rows ?? {};
    for (const row of Object.values(rows)) {
      if (row.status !== 'collecting' && row.status !== 'rewriting') continue;
      const staged = row.originalText && row.rewrittenText && !validateRewrite(row.originalText, row.rewrittenText);
      save(agent.session, { ...row, status: staged ? 'ready' : 'fallback', reason: 'interrupted-rewrite', finishedAt: Date.now() });
    }
  }
  ctx.on('agent/created', ({ agent }) => { recover(agent); return undefined; }, { global: true });
  for (const agent of ctx.agents.roots()) recover(agent);
  ctx.on('agent/disposed', ({ agent }) => {
    cancel(agent, 'agent-disposed'); states.delete(agent);
    requestCancels.get(agent)?.(); requestCancels.delete(agent);
  }, { global: true });
  ctx.effect(() => async () => {
    lifetime.abort(new Error('plugin-disposed'));
    for (const dispose of requestCancels.values()) dispose();
    requestCancels.clear();
    for (const agent of states.keys()) cancel(agent, 'plugin-disposed');
    await Promise.allSettled([...jobs.values()].flatMap(tasks => [...tasks]));
    states.clear(); jobs.clear();
  });
}
