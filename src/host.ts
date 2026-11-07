import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage, type GenerateOptions, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { appendPluginRecord, type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-settings';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import { createHash } from 'node:crypto';
import { RECORD, PROJECTION, ProjectionSchema, StateSchema, WorkContextSchema, stepKey, matchRule, type RetryRequest, type RetryResponse, type Rewrite, type Settings } from './contract.ts';
import { readSettings, type RuntimeSettings } from './config.ts';
export { Config } from './config.ts';
import { foldRewrites } from './projection.ts';
import { skipText, validateRewrite, validateReport } from './policy.ts';
import { RewriteQueue } from './queue.ts';
import { captureWorkContext, type WorkContext } from './work-context.ts';
import { completedPrefix, hasCompletedFinal, hasCompletedTranslation, stageRequest } from './report-progress.ts';
import { RetryService } from './retry-service.ts';
import { inputBudget, inputLimitMessage } from './failure.ts';
import { TRANSLATION_MARKER, TRANSLATION_SECTION, translationRequest, translationRule } from './prompt.ts';

export const inject = ['agents', 'sessions', 'llm', 'sessionProjections'];

interface Attempt { row: Rewrite; policy: Settings; context?: WorkContext; terminal: boolean; done: boolean; controller: AbortController }
interface WorkspaceRegistryLike { resolveByPath(path: string): Promise<{ id: unknown } | undefined> }
interface TranslationStep { enabled: boolean; provider: string; model: string }
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
export async function apply(ctx: Context, raw: RuntimeSettings = {}) {
  const queue = new RewriteQueue(readSettings(raw).maxConcurrentRewrites);
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  const states = new Map<Agent, Map<string, Attempt>>();
  const jobs = new Map<Agent, Set<Promise<void>>>();
  const lifetime = new AbortController();
  const requestCancels = new Map<Agent, () => void>();
  const settled = new WeakMap<Session, SessionEvent<'assistant/message'>>();
  const translationRuleIntents = new Map<Agent, { provider: string; model: string; at: number }>();
  const translationSteps = new Map<Agent, Map<string, TranslationStep>>();
  const projection = await ctx.sessionProjections.register({
    key: PROJECTION, stateSchema: StateSchema, stateVersion: 1,
    init: () => ({ rows: {}, latestUser: '', synced: [] }), apply: foldRewrites,
    // Full requests/work records stay in the durable log, not the chat projection wire.
    wire: { viewSchema: ProjectionSchema, view: state => Object.fromEntries(Object.entries(state.rows).map(([key, { context: _context, stages: _stages, request: _request, ...row }]) => [key, row])) },
  });
  new RetryService(ctx, retry);

  const isMain = (agent: Agent) => agent.session.header.origin !== 'subagent' && ctx.agents.roots().some(root => root.id === agent.id);
  async function translationEnabledFor(agent: Agent, settings: Settings): Promise<boolean> {
    if (!settings.enabled || settings.translationWorkspaces.length === 0) return false;
    const registry = (ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as WorkspaceRegistryLike | undefined;
    const cwd = agent.session.header.cwd;
    if (!registry || !cwd) return false;
    try {
      const workspace = await registry.resolveByPath(cwd);
      return workspace !== undefined && settings.translationWorkspaces.includes(String(workspace.id));
    } catch {
      // A missing or inaccessible project directory must never make prompt assembly fail.
      return false;
    }
  }
  /** Check the effective system-prompt surface node, not the pre-complete assembly. */
  function systemPromptHasTranslationRule(agent: Agent): boolean {
    const nodes = agent.session.surface.nodes;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const event = agent.session.eventAt(nodes[index]);
      if (event?.type !== 'system/message') continue;
      const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      // Empty later system nodes are dormant and project to no message; keep
      // looking for the effective non-empty node.
      if (!text.trim()) continue;
      return text.includes(TRANSLATION_MARKER);
    }
    return false;
  }
  function takeTranslationStep(agent: Agent, turn: number, step: number) {
    const map = translationSteps.get(agent);
    if (!map) return undefined;
    const key = stepKey(turn, step);
    const value = map.get(key);
    map.delete(key);
    if (!map.size) translationSteps.delete(agent);
    return value;
  }
  function saveBypass(agent: Agent, frame: Extract<AssistantStreamFrame, { type: 'start' }>, reason: string, rule: ReturnType<typeof matchRule>) {
    const source = rule?.source ?? { provider: agent.session.requestHeader()?.config.provider ?? 'unknown', model: agent.session.requestHeader()?.config.model ?? 'unknown' };
    const writer = rule?.writer ?? source;
    save(agent.session, {
      schemaVersion: 1, policyVersion: 3, promptVersion: 3, sessionId: agent.session.id,
      turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
      source, writer, status: 'bypass', reason, retryCount: 0, reviewRounds: 0, startedAt: Date.now(),
    });
  }
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
        update(agent, attempt, { status: 'cancelled', reason, rewrittenText: undefined, finishedAt: Date.now() });
      }
    }
  }
  async function rewrite(agent: Agent, attempt: Attempt, maintenanceSignal?: AbortSignal) {
    const settings = attempt.policy;
    const { originalText = '' } = attempt.row;
    const timeout = new AbortController();
    const timer = settings.timeoutMs > 0 ? setTimeout(() => timeout.abort(new Error('timeout')), settings.timeoutMs) : undefined;
    const signal = AbortSignal.any([attempt.controller.signal, lifetime.signal, timeout.signal, ...(maintenanceSignal ? [maintenanceSignal] : [])]);
    try {
      await queue.run(signal, async () => {
        const context = attempt.context;
        if (!context) throw new Error('writer-context-missing');
        const activeStages = [...(attempt.row.activeStages ?? [])];
        let ownDraft = attempt.row.stages?.[activeStages.at(-1)!]?.output;
        for (let round = activeStages.length; round <= settings.reviewRounds; round++) {
          signal.throwIfAborted();
          const kind = round === 0 ? 'draft' : 'review';
          // A's final report is introduced only after B has produced its independent draft.
          const { system, input } = stageRequest(settings, context, originalText, round, ownDraft);
          const budget = inputBudget(settings, { system, input });
          if (budget) {
            update(agent, attempt, { inputBudget: budget, phase: round === 0 ? 'drafting' : 'reviewing', reviewRound: round });
            throw new Error('input-limit');
          }
          const stages: NonNullable<Rewrite['stages']> = [...(attempt.row.stages ?? []), { kind, round, system, input, writer: attempt.row.writer, startedAt: Date.now() }];
          activeStages.push(stages.length - 1);
          if (!update(agent, attempt, { status: 'rewriting', phase: round === 0 ? 'drafting' : 'reviewing', reviewRound: round, stages, activeStages: [...activeStages] })) return;
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
  async function translate(agent: Agent, attempt: Attempt, maintenanceSignal?: AbortSignal) {
    const settings = attempt.policy;
    const originalText = attempt.row.originalText ?? '';
    const timeout = new AbortController();
    const timer = settings.timeoutMs > 0 ? setTimeout(() => timeout.abort(new Error('timeout')), settings.timeoutMs) : undefined;
    const signal = AbortSignal.any([attempt.controller.signal, lifetime.signal, timeout.signal, ...(maintenanceSignal ? [maintenanceSignal] : [])]);
    try {
      await queue.run(signal, async () => {
        const { system, input } = translationRequest(settings, originalText);
        const budget = inputBudget(settings, { system, input });
        if (budget) {
          update(agent, attempt, { inputBudget: budget, phase: 'translating', reviewRound: 0 });
          throw new Error('input-limit');
        }
        const stages: NonNullable<Rewrite['stages']> = [...(attempt.row.stages ?? []), { kind: 'translate', round: 0, system, input, writer: attempt.row.writer, startedAt: Date.now() }];
        if (!update(agent, attempt, { status: 'rewriting', phase: 'translating', reviewRound: 0, stages, activeStages: [stages.length - 1] })) return;
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
        let translated = '';
        try {
          translated = await raceAbort(generate(), signal);
          signal.throwIfAborted();
          stages[stages.length - 1] = { ...stages.at(-1)!, output: translated, usage: assembled.usage, finishedAt: Date.now() };
        } catch (error) {
          if (attempt.row.status === 'rewriting') {
            stages[stages.length - 1] = { ...stages.at(-1)!, usage: assembled.usage, finishedAt: Date.now() };
            update(agent, attempt, { stages, usage: totalUsage(stages) });
          }
          throw error;
        }
        if (attempt.row.status !== 'rewriting' || !update(agent, attempt, { stages, usage: totalUsage(stages) })) return;
        await ctx.sessions.flush(agent.session);
        signal.throwIfAborted();
        if (attempt.row.status !== 'rewriting') return;
        update(agent, attempt, { rewrittenText: translated, translationTarget: settings.translationTarget });
        await ctx.sessions.flush(agent.session);
        signal.throwIfAborted();
        update(agent, attempt, { status: 'ready', finishedAt: Date.now() });
        await ctx.sessions.flush(agent.session);
      });
    } catch (error) {
      if (attempt.row.status === 'cancelled') return;
      const reason = timeout.signal.aborted ? 'timeout' : signal.aborted ? 'cancelled' : error instanceof Error && /^(input-limit|output-limit|writer-|protected-|empty-output|question-lost)/.test(error.message) ? error.message : 'writer-or-storage-error';
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
  async function retry(request: RetryRequest): Promise<RetryResponse> {
    let agent = ctx.agents.roots().find(root => root.session.id === request.sessionId);
    if (!agent) {
      const controller = ctx.get('sessionController');
      if (!controller) return { accepted: false, message: '会话暂不可用，请重新打开会话后重试。' };
      const result = await controller.resolveAgent(request.sessionId as Session['id']);
      if ('error' in result) return { accepted: false, message: '会话暂不可用，请重新打开会话后重试。' };
      agent = result.agent;
    }
    if (!isMain(agent) || agent.status !== 'idle') return { accepted: false, message: '请等待 A 完成当前工作后再重试。' };
    const row = projection.stateOf(agent.session).rows[stepKey(request.turn, request.step)];
    if (!row || ![2, 3].includes(row.policyVersion) || row.attemptId !== request.attemptId || row.originalMessageId !== request.originalMessageId || (row.retryCount ?? 0) !== request.retryCount || !['fallback', 'cancelled'].includes(row.status)) return { accepted: false, message: '这条回复的状态已改变，请刷新后再试。' };
    const messages = agent.session.deriveMessages();
    const position = messages.findIndex(message => message.id === row.originalMessageId);
    const original = messages[position];
    const originalText = original?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    if (!original || original.role !== 'assistant' || originalText !== row.originalText || (row.sourceHash && row.sourceHash !== hash(originalText!))) return { accepted: false, message: '原回复已删除或改变，无法重试。' };
    const settings = readSettings(raw);
    const rule = matchRule(settings, row.source);
    if (!rule) return { accepted: false, message: '请先在插件设置中启用 B，并配置匹配的 A 模型。' };
    if (row.policyVersion === 3) {
      if (!(await translationEnabledFor(agent, settings))) return { accepted: false, message: '当前项目未启用“英文底稿和中文翻译”，请先在插件设置中启用后重试。' };
      const next: Rewrite = { ...row, sessionId: agent.session.id, writer: rule.writer, translationTarget: settings.translationTarget,
        stages: row.stages?.map(stage => ({ ...stage, writer: stage.writer ?? row.writer })),
        reviewRounds: 0, retryCount: (row.retryCount ?? 0) + 1, status: 'rewriting', phase: 'translating', reviewRound: 0,
        rewrittenText: undefined, reason: undefined, inputBudget: undefined, finishedAt: undefined, context: undefined, activeStages: [] };
      const budget = inputBudget(settings, translationRequest(settings, next.originalText!));
      if (budget) return { accepted: false, message: inputLimitMessage(budget) };
      const attempt: Attempt = { row: next, policy: settings, terminal: true, done: true, controller: new AbortController() };
      const owner = agent;
      try {
        const task = owner.runMaintenance(async signal => {
          const map = states.get(owner) ?? new Map<string, Attempt>(); states.set(owner, map);
          map.set(stepKey(row.turn, row.step), attempt);
          queue.setCapacity(settings.maxConcurrentRewrites);
          save(owner.session, next);
          await translate(owner, attempt, signal);
        });
        track(owner, task);
      } catch { return { accepted: false, message: '会话正在处理其他操作，请稍后重试。' }; }
      return { accepted: true };
    }
    let context = row.context;
    if (!context && row.stages?.[0]) {
      try { const parsed = WorkContextSchema.safeParse(JSON.parse(row.stages[0].input)); if (parsed.success) context = parsed.data; } catch {}
    }
    // Older failures before the first B call did not save a request. Use only
    // the surviving history prefix before A's report, never later conversation.
    context ??= captureWorkContext(messages.slice(0, position), projection.stateOf(agent.session).rows);
    if (!context.workContext.length) return { accepted: false, message: '这条历史回复缺少可恢复的工作材料，无法重试。' };
    const next: Rewrite = { ...row, sessionId: agent.session.id, writer: rule.writer, context,
      stages: row.stages?.map(stage => ({ ...stage, writer: stage.writer ?? row.writer })),
      reviewRounds: settings.reviewRounds, retryCount: (row.retryCount ?? 0) + 1, status: 'rewriting',
      rewrittenText: undefined, reason: undefined, inputBudget: undefined, finishedAt: undefined };
    next.activeStages = completedPrefix(next, settings, context);
    // Reject a deterministically blocked retry before claiming maintenance or
    // incrementing its counter; use today's settings and the next unreused stage.
    if (next.activeStages.length <= settings.reviewRounds) {
      const ownDraft = next.stages?.[next.activeStages.at(-1)!]?.output;
      const request = stageRequest(settings, context, next.originalText!, next.activeStages.length, ownDraft);
      const budget = inputBudget(settings, request);
      if (budget) return { accepted: false, message: inputLimitMessage(budget) };
    }
    next.reviewRound = Math.min(next.activeStages.length, settings.reviewRounds);
    next.phase = next.activeStages.length ? 'reviewing' : 'drafting';
    const attempt: Attempt = { row: next, policy: settings, context, terminal: true, done: true, controller: new AbortController() };
    const owner = agent;
    try {
      const task = owner.runMaintenance(async signal => {
        const map = states.get(owner) ?? new Map<string, Attempt>(); states.set(owner, map);
        map.set(stepKey(row.turn, row.step), attempt);
        queue.setCapacity(settings.maxConcurrentRewrites);
        save(owner.session, next);
        await rewrite(owner, attempt, signal);
      });
      track(owner, task);
    } catch { return { accepted: false, message: '会话正在处理其他操作，请稍后重试。' }; }
    return { accepted: true };
  }
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    const agent = context.agent;
    if (!agent || !isMain(agent)) return result;
    const settings = readSettings(raw);
    const provider = result.variables.provider;
    const model = result.variables.model;
    if (!settings.enabled || provider === undefined || model === undefined || !matchRule(settings, { provider, model })) {
      translationRuleIntents.delete(agent);
      return result;
    }
    if (!(await translationEnabledFor(agent, settings))) {
      translationRuleIntents.delete(agent);
      return result;
    }
    translationRuleIntents.set(agent, { provider, model, at: Date.now() });
    return {
      ...result,
      sections: [...result.sections.filter(section => section.name !== TRANSLATION_SECTION), {
        name: TRANSLATION_SECTION, text: translationRule(provider, model), interpolate: false,
      }],
    };
  }, { global: true, prepend: true });

  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const config = await next();
    if (!isMain(agent)) return config;
    const settings = readSettings(raw);
    const rule = matchRule(settings, config);
    const enabled = rule !== undefined && await translationEnabledFor(agent, settings);
    const map = translationSteps.get(agent) ?? new Map<string, TranslationStep>();
    map.set(stepKey(turn, step), { enabled, provider: config.provider, model: config.model });
    translationSteps.set(agent, map);
    return config;
  }, { global: true, prepend: true });

  function onFrame(agent: Agent, frame: AssistantStreamFrame) {
    if (!isMain(agent)) return;
    const map = states.get(agent) ?? new Map<string, Attempt>();
    states.set(agent, map);
    if (frame.type === 'start') {
      const settings = readSettings(raw);
      if (!settings.enabled) {
        translationRuleIntents.delete(agent);
        return;
      }
      queue.setCapacity(settings.maxConcurrentRewrites);
      const actual = agent.session.requestHeader()?.config;
      if (!actual) return;
      const rule = matchRule(settings, actual);
      const recorded = translationRuleIntents.get(agent);
      translationRuleIntents.delete(agent);
      // A diagnostic assembly must not make a much later real step look translated.
      const intent = recorded && Date.now() - recorded.at < 30_000 ? recorded : undefined;
      const translation = takeTranslationStep(agent, frame.turn, frame.step);
      const key = stepKey(frame.turn, frame.step);
      map.get(key)?.controller.abort(new Error('superseded'));
      // The prompt was assembled for `intent`; a later reroute must not translate a different model.
      if (intent && (intent.provider !== actual.provider || intent.model !== actual.model)) {
        saveBypass(agent, frame, 'translation-route-changed', rule);
        return;
      }
      const useTranslation = intent !== undefined ? rule !== undefined : translation?.enabled === true;
      if (useTranslation) {
        if (!rule || (translation && (translation.provider !== actual.provider || translation.model !== actual.model))) {
          saveBypass(agent, frame, 'translation-route-changed', rule);
          return;
        }
        // Translation receives only the committed A text; no work materials are collected or stored.
        const attempt: Attempt = {
          row: { schemaVersion: 1, policyVersion: 3, promptVersion: 3, sessionId: agent.session.id,
            turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
            source: rule.source, writer: rule.writer, status: 'collecting', retryCount: 0, reviewRounds: 0,
            translationTarget: settings.translationTarget, startedAt: Date.now() },
          policy: settings, terminal: false, done: false, controller: new AbortController(),
        };
        map.set(key, attempt);
        save(agent.session, attempt.row);
        return;
      }
      if (!rule) return;
      const attempt: Attempt = {
        row: { schemaVersion: 1, policyVersion: 2, promptVersion: 2, sessionId: agent.session.id,
          turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
          source: rule.source, writer: rule.writer, status: 'collecting', retryCount: 0, reviewRounds: settings.reviewRounds, startedAt: Date.now() },
        context: captureWorkContext(agent.session.deriveMessages(), projection.stateOf(agent.session).rows),
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
    if (attempt.row.policyVersion === 3 && !systemPromptHasTranslationRule(agent)) {
      attempt.context = undefined;
      update(agent, attempt, { status: 'bypass', reason: 'translation-rule-missing' });
      return;
    }
    const patch: Partial<Rewrite> = attempt.row.policyVersion === 3
      ? { status: 'rewriting', originalMessageId: message.id, sourceHash: hash(text), originalText: text, phase: 'translating', reviewRound: 0 }
      : { status: 'rewriting', context: attempt.context, originalMessageId: message.id, sourceHash: hash(text), originalText: text };
    if (!update(agent, attempt, patch)) return;
    track(agent, attempt.row.policyVersion === 3 ? translate(agent, attempt) : rewrite(agent, attempt));
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
    const state = projection.stateOf(agent.session);
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
    const rows = projection.stateOf(agent.session).rows;
    for (const row of Object.values(rows)) {
      if (row.status !== 'collecting' && row.status !== 'rewriting') continue;
      const staged = row.policyVersion === 1
        ? row.originalText && row.rewrittenText && !validateRewrite(row.originalText, row.rewrittenText)
        : row.policyVersion === 3 ? hasCompletedTranslation(row) : hasCompletedFinal(row);
      save(agent.session, { ...row, status: staged ? 'ready' : 'fallback', rewrittenText: staged ? row.rewrittenText : undefined, reason: 'interrupted-rewrite', finishedAt: Date.now() });
    }
  }
  ctx.on('agent/created', ({ agent }) => { recover(agent); return undefined; }, { global: true });
  for (const agent of ctx.agents.roots()) recover(agent);
  ctx.on('agent/disposed', ({ agent }) => {
    cancel(agent, 'agent-disposed'); states.delete(agent);
    translationRuleIntents.delete(agent); translationSteps.delete(agent);
    requestCancels.get(agent)?.(); requestCancels.delete(agent);
  }, { global: true });
  ctx.effect(() => async () => {
    lifetime.abort(new Error('plugin-disposed'));
    for (const dispose of requestCancels.values()) dispose();
    requestCancels.clear();
    for (const agent of states.keys()) cancel(agent, 'plugin-disposed');
    await Promise.allSettled([...jobs.values()].flatMap(tasks => [...tasks]));
    states.clear(); jobs.clear(); translationRuleIntents.clear(); translationSteps.clear();
  });
}
