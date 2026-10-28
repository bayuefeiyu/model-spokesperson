import { z } from 'zod';
import type {} from '@deepseek-ai/dsh-session-projection/types';

export const RECORD = 'plugin:model-spokesperson/rewrite' as const;
export const PROJECTION = 'modelSpokesperson' as const;
export const RouteSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export type Route = z.infer<typeof RouteSchema>;
export const RuleSchema = z.object({ source: RouteSchema, writer: RouteSchema });
export const SettingsSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.array(RuleSchema).default([]),
  style: z.string().max(4000).default('中文，结论先行，少术语，忠实于原文。'),
  timeoutMs: z.number().int().min(1).max(300000).default(45000),
  maxConcurrentRewrites: z.number().int().min(1).max(16).default(2),
  maxInputChars: z.number().int().min(1).max(200000).default(30000),
  maxOutputTokens: z.number().int().min(1).max(32768).default(8192),
}).superRefine((config, ctx) => {
  const seen = new Set<string>();
  config.rules.forEach((rule, index) => {
    const key = JSON.stringify(rule.source);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['rules', index], message: '同一来源路由只能配置一次' });
    seen.add(key);
  });
  if (config.enabled && config.rules.length === 0) ctx.addIssue({ code: 'custom', path: ['rules'], message: '启用时至少配置一个来源模型' });
});
export type Settings = z.infer<typeof SettingsSchema>;

export const RewriteSchema = z.object({
  schemaVersion: z.literal(1), policyVersion: z.literal(1), promptVersion: z.literal(1),
  sessionId: z.string(), turn: z.number().int(), step: z.number().int(), attemptId: z.string(),
  source: RouteSchema, writer: RouteSchema,
  status: z.enum(['collecting', 'rewriting', 'ready', 'bypass', 'fallback', 'cancelled']),
  originalMessageId: z.string().optional(), sourceHash: z.string().optional(), originalText: z.string().optional(),
  rewrittenText: z.string().optional(), reason: z.string().optional(),
  startedAt: z.number(), finishedAt: z.number().optional(),
  usage: z.unknown().optional(),
  request: z.object({ system: z.string(), input: z.string() }).optional(),
});
export type Rewrite = z.infer<typeof RewriteSchema>;
export const ProjectionSchema = z.record(z.string(), RewriteSchema);
export type RewriteProjection = z.infer<typeof ProjectionSchema>;
export const StateSchema = z.object({ rows: ProjectionSchema, latestUser: z.string(), synced: z.array(z.string()) });
export type RewriteState = z.infer<typeof StateSchema>;
export const stepKey = (turn: number, step: number) => `${turn}:${step}`;
export const routeEquals = (a: Route, b: Route) => a.provider === b.provider && a.model === b.model;
export function matchRule(settings: Settings, route: Route) {
  return settings.enabled ? settings.rules.find(rule => routeEquals(rule.source, route)) : undefined;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { modelSpokesperson: RewriteProjection }
  interface SessionProjectionStateMap { modelSpokesperson: RewriteState }
}
