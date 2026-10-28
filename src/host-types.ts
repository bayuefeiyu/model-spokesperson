import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-llm';
import type { Rewrite } from './contract.ts';
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap { 'plugin:model-spokesperson/rewrite': Rewrite }
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'model-spokesperson': { kind: 'model-spokesperson'; originalMessageId: string; form: 'notice'; summary: string };
  }
}
