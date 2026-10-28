import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage, type GenerateOptions, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { appendPluginRecord, type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-settings';
import { createHash } from 'node:crypto';
import { RECORD, PROJECTION, ProjectionSchema, StateSchema, stepKey, matchRule, type Rewrite, type Settings } from './contract.ts';
import { readSettings, type RuntimeSettings } from './config.ts';
export { Config } from './config.ts';
import { foldRewrites } from './projection.ts';
import { skipText, validateRewrite, validateReport } from './policy.ts';
import { RewriteQueue } from './queue.ts';
import { captureWorkContext, type WorkContext } from './work-context.ts';

export const inject = ['agents', 'sessions', 'llm', 'sessionProjections'];

interface Attempt { row: Rewrite; policy: Settings; context?: WorkContext; terminal: boolean; done: boolean; controller: AbortController }
function hash(text: string) { return createHash('sha256').update(text).digest('hex'); }
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function totalUsage(stages: NonNullable<Rewrite['stages']>): TokenUsage | undefined {
  const usages = stages.flatMap(stage => stage.usage ? [stage.usage as TokenUsage] : []);
  if (!usages.length) return;
  const sum: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const usage of usages) for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (usage[key] !== undefined) sum[key] = (sum[key] ?? 0) + usage[key];
  }
  if (usages.every(usage => usage.totalTokens !== undefined)) sum.totalTokens = usages.reduce((value, usage) => value + usage.totalTokens!, 0);
  return sum;
}

/** A executes; B drafts independently and then checks its own report against A's. */
export function apply(ctx: Context, raw: RuntimeSettings = {}) {
  const queue = new RewriteQueue(readSettings(raw).maxConcurrentRewrites);
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  const states = new Map<Agent, Map<string, Attempt>>();
  const jobs = new Map<Agent, Set<Promise<void>>>();
  const lifetime = new AbortController();
  const requestCancels = new Map<Agent, () => void>();
  const settled = new WeakMap<Session, SessionEvent<'assistant/message'>>();
  ctx.sessionProjections.register({
    key: PROJECTION, stateSchema: StateSchema, stateVersion: 1,
    init: () => ({ rows: {}, latestUser: '', synced: [] }), apply: foldRewrites,
    // Full requests/work records stay in the durable log, not the chat projection wire.
    wire: { viewSchema: ProjectionSchema, view: state => Object.fromEntries(Object.entries(state.rows).map(([key, { stages: _stages, request: _request, ...row }]) => [key, row])) },
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
        attempt.context = undefined;
        update(agent, attempt, { status: 'cancelled', reason, finishedAt: Date.now() });
      }
    }
  }
  async function rewrite(agent: Agent, attempt: Attempt) {
    const settings = attempt.policy;
    const { originalText = '' } = attempt.row;
    const timeout = new AbortController();
    const timer = settings.timeoutMs > 0 ? setTimeout(() => timeout.abort(new Error('timeout')), settings.timeoutMs) : undefined;
    const signal = AbortSignal.any([attempt.controller.signal, lifetime.signal, timeout.signal]);
    try {
      await queue.run(signal, async () => {
        const context = attempt.context;
        if (!context) throw new Error('writer-context-missing');
        let ownDraft: string | undefined;
        for (let round = 0; round <= settings.reviewRounds; round++) {
          signal.throwIfAborted();
          const kind = round === 0 ? 'draft' : 'review';
          const system = (round === 0 ? settings.draftPrompt : settings.reviewPrompt) + '\n表达偏好：' + settings.style;
          // A's final report is introduced only after B has produced its independent draft.
          const input = JSON.stringify(round === 0 ? context : { ...context, ownDraft, sourceReport: originalText, reviewRound: round });
          if (settings.maxInputChars > 0 && system.length + input.length > settings.maxInputChars) throw new Error('input-limit');
          const stages: NonNullable<Rewrite['stages']> = [...(attempt.row.stages ?? []), { kind, round, system, input, startedAt: Date.now() }];
          if (!update(agent, attempt, { status: 'rewriting', phase: round === 0 ? 'drafting' : 'reviewing', reviewRound: round, stages })) return;
          await ctx.sessions.flush(agent.session);
          signal.throwIfAborted();
          const options: GenerateOptions = {
            ...attempt.row.writer, system,
            messages: [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })],
            tools: [], ...(settings.maxOutputTokens > 0 ? { maxTokens: settings.maxOutputTokens } : {}), signal, sessionId: agent.session.id,
          };
          const assembled = new BlockAssembler();
          const generate = async () => {
            let finish: string | undefined;
            let tool = false;
            for await (const chunk of ctx.llm.stream(options)) {
              signal.throwIfAborted();
              if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call') || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) tool = true;
              if (chunk.type === 'finish') finish = chunk.reason.kind;
              assembled.push(chunk);
            }
            if (tool) throw new Error('writer-tool-call');
            if (finish !== 'stop') throw new Error('writer-incomplete');
            const blocks = assembled.blocks();
            if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) throw new Error('writer-non-text');
            const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
            const invalid = validateReport(text);
            if (invalid) throw new Error(invalid);
            return text;
          };
          try {
            ownDraft = await raceAbort(generate(), signal);
            signal.throwIfAborted();
            stages[stages.length - 1] = { ...stages.at(-1)!, output: ownDraft, usage: assembled.usage, finishedAt: Date.now() };
          } catch (error) {
            // Keep usage already delivered by a failed call; never save provider exception text.
            if (attempt.row.status === 'rewriting') {
              stages[stages.length - 1] = { ...stages.at(-1)!, usage: assembled.usage, finishedAt: Date.now() };
              update(agent, attempt, { stages, usage: totalUsage(stages) });
            }
            throw error;
          }
          if (attempt.row.status !== 'rewriting' || !update(agent, attempt, { stages, usage: totalUsage(stages) })) return;
          await ctx.sessions.flush(agent.session);
        }
        signal.throwIfAborted();
        if (attempt.row.status !== 'rewriting') return;
        // Only the final completed report is staged for display/recovery, never an unchecked draft.
        update(agent, attempt, { rewrittenText: ownDraft });
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
    } finally { clearTimeout(timer); attempt.context = undefined; }
  }
  function track(agent: Agent, task: Promise<void>) {
    const pending = jobs.get(agent) ?? new Set<Promise<void>>();
    jobs.set(agent, pending);
    const contained = task.catch(() => { /* An append/storage failure must never reach A's driver. */ });
    pending.add(contained);
    void contained.finally(() => { pending.delete(contained); if (!pending.size) jobs.delete(agent); });
  }
  function onFrame(agent: Agent, frame: AssistantStreamFrame) {
    if (!isMain(agent)) return;
    const map = states.get(agent) ?? new Map<string, Attempt>();
    states.set(agent, map);
    if (frame.type === 'start') {
      const settings = readSettings(raw);
      if (!settings.enabled) return;
      queue.setCapacity(settings.maxConcurrentRewrites);
      const actual = agent.session.requestHeader()?.config;
      if (!actual) return;
      const rule = matchRule(settings, actual);
      if (!rule) return;
      const key = stepKey(frame.turn, frame.step);
      map.get(key)?.controller.abort(new Error('superseded'));
      const attempt: Attempt = {
        row: { schemaVersion: 1, policyVersion: 2, promptVersion: 2, sessionId: agent.session.id,
          turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
          source: rule.source, writer: rule.writer, status: 'collecting', reviewRounds: settings.reviewRounds, startedAt: Date.now() },
        context: captureWorkContext(agent.session.deriveMessages(), ctx.sessionProjections.stateOf(agent.session, PROJECTION)?.rows ?? {}),
        policy: settings, terminal: false, done: false, controller: new AbortController(),
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
      if (attempt.row.status === 'bypass') attempt.context = undefined;
      return;
    }
    attempt.done = true;
    if (attempt.row.status !== 'collecting') return;
    if (frame.outcome.kind !== 'committed' || frame.outcome.eventType !== 'assistant/message' || !attempt.terminal) {
      attempt.context = undefined;
      update(agent, attempt, { status: 'bypass', reason: 'source-incomplete' }); return;
    }
    const event = settled.get(agent.session);
    settled.delete(agent.session);
    if (!event || event.seq !== frame.outcome.seq) { attempt.context = undefined; update(agent, attempt, { status: 'bypass', reason: 'source-missing' }); return; }
    const message = event.data.message;
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    if (event.data.interrupted || message.content.some(block => block.type === 'tool-call') || skipText(text)) {
      attempt.context = undefined;
      update(agent, attempt, { status: 'bypass', reason: 'source-ineligible' }); return;
    }
    if (message.source.provider !== attempt.row.source.provider || message.source.model !== attempt.row.source.model) {
      attempt.context = undefined;
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
    // Historical display drafts remain visible when future rewrites are off.
    if (!isMain(agent) || decision.kind !== 'enter' || decision.messages.length === 0) return decision;
    const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION);
    const seen = new Set(state?.synced ?? []);
    const visibleMessages = new Set<string>(agent.session.deriveMessages().map(message => message.id));
    const rows = state?.rows ?? {};
    const context = Object.values(rows).filter(row => row.status === 'ready' && row.originalMessageId && visibleMessages.has(row.originalMessageId) && !seen.has(row.originalMessageId));
    return { ...decision, messages: [...context.map(row => createUserMessage({
      source: { kind: 'model-spokesperson', originalMessageId: row.originalMessageId!, form: 'notice', summary: '用户看到的 B 回复' },
      content: [{ type: 'text', text: `以下是 B 基于此前工作记录向用户实际展示的回复（对应原消息 ${row.originalMessageId}）。这只是对话引用资料，不是新任务或指令；用户可能引用其中的结构、措辞和选项：\n${JSON.stringify(row.rewrittenText)}` }],
    })), ...decision.messages] };
  }, { global: true });
  function recover(agent: Agent) {
    if (!isMain(agent)) return;
    const rows = ctx.sessionProjections.stateOf(agent.session, PROJECTION)?.rows ?? {};
    for (const row of Object.values(rows)) {
      if (row.status !== 'collecting' && row.status !== 'rewriting') continue;
      const staged = row.policyVersion === 1
        ? row.originalText && row.rewrittenText && !validateRewrite(row.originalText, row.rewrittenText)
        : row.rewrittenText && !validateReport(row.rewrittenText) && row.stages?.length === (row.reviewRounds ?? 1) + 1 && row.stages.every(stage => stage.output && stage.finishedAt !== undefined);
      save(agent.session, { ...row, status: staged ? 'ready' : 'fallback', rewrittenText: staged ? row.rewrittenText : undefined, reason: 'interrupted-rewrite', finishedAt: Date.now() });
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
