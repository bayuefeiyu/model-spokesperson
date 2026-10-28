import schema from '@deepseek-ai/schemastery';
import { isVolatile } from '@deepseek-ai/cosmokit';
import type { Volatile } from '@deepseek-ai/cosmokit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { SettingsSchema, type Settings } from './contract.ts';
import { DRAFT_SYSTEM, REVIEW_SYSTEM } from './prompt.ts';

export type RuntimeSettings = Partial<{ [K in keyof Settings]: Settings[K] | Volatile<Settings[K]> }>;
export function readSettings(raw: RuntimeSettings): Settings {
  return SettingsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, isVolatile(value) ? value.get() : value])));
}
const route = schema.object({ provider: schema.string().min(1).required(), model: schema.string().min(1).required() });
export const Config = schema.object({
  enabled: schema.boolean().default(false).volatile(),
  rules: schema.array(schema.object({ source: route.required(), writer: route.required() })).default([]).volatile(),
  style: schema.string().max(4000).default('中文，结论先行，少术语，清楚自然，事实准确。').volatile(),
  draftPrompt: schema.string().default(DRAFT_SYSTEM).volatile(),
  reviewPrompt: schema.string().default(REVIEW_SYSTEM).volatile(),
  reviewRounds: schema.natural().max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
  timeoutMs: schema.natural().max(2147483647).default(0).volatile(),
  maxConcurrentRewrites: schema.natural().min(1).max(16).default(2).volatile(),
  maxInputChars: schema.natural().max(Number.MAX_SAFE_INTEGER).default(0).volatile(),
  maxOutputTokens: schema.natural().max(Number.MAX_SAFE_INTEGER).default(0).volatile(),
});
// Keep the native Schemastery object/metadata for Loader and Settings, and add
// the same cross-field validation used by the editor before live refs commit.
const standard = Config['~standard'];
function check(result: StandardSchemaV1.Result<unknown>): StandardSchemaV1.Result<unknown> {
  if (result.issues) return result;
  try { readSettings(result.value as RuntimeSettings); return result; }
  catch (error) { return { issues: [{ message: error instanceof Error ? error.message : '配置无效' }] }; }
}
Object.defineProperty(Config, '~standard', { value: { ...standard, validate(value: unknown) {
  const result = standard.validate(value);
  return result instanceof Promise ? result.then(check) : check(result);
} } });
