import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from './host-types.ts';
import { pluginRecordOf } from '@deepseek-ai/dsh-session';
import { RECORD, RewriteSchema, stepKey, type RewriteState } from './contract.ts';

export function foldRewrites(state: RewriteState, event: SessionEvent): RewriteState {
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user') return { ...state, latestUser: event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') };
    if (event.data.source.kind === 'model-spokesperson') return { ...state, synced: [...state.synced, event.data.source.originalMessageId] };
  }
  const record = pluginRecordOf(event);
  if (record?.type !== RECORD) return state;
  const result = RewriteSchema.safeParse(record.data);
  if (!result.success) return state;
  const row = result.data;
  return { ...state, rows: { ...state.rows, [stepKey(row.turn, row.step)]: row } };
}
