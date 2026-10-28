import React, { useState, type ComponentType, type CSSProperties } from 'react';
import type { ChatNodeViewProps, AssistantBlock } from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import { PROJECTION, stepKey, type Rewrite } from './contract.ts';

export type AssistantProps = ChatNodeViewProps<'assistant-step'> & Record<string, unknown>;
const hint: CSSProperties = { fontFamily: 'system-ui, sans-serif', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #64748b)', marginTop: 8 };

/** Rendering-only data view: raw Nodes, provider metadata and copy provenance remain intact. */
export function presentation(row: Rewrite | undefined, props: AssistantProps) {
  const data = props.node.data;
  if (!row || row.turn !== data.turn || row.step !== data.step) return 'original';
  const text = data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('');
  // An in-flight row is admitted before any live chunks. Settled rows must prove message + source identity.
  if (data.status === 'interrupted' || data.blocks.some(block => block.kind === 'tool-call')) return 'original';
  if (row.status === 'collecting') return 'pending';
  if (data.status !== 'running' && (row.originalMessageId !== data.finalNode?.messageId || row.originalText !== text)) return 'original';
  if (row.status === 'rewriting') return 'pending';
  if (row.status === 'ready' && row.rewrittenText) return 'ready';
  if (row.status === 'fallback' || row.status === 'cancelled') return 'fallback';
  return 'original';
}

export function createAssistantView(Default: ComponentType<AssistantProps>) {
  return function SpokespersonAssistant(props: AssistantProps) {
    const [copyState, setCopyState] = useState('复制 B 回复');
    const rows = props.useProjection(PROJECTION);
    const row = rows?.[stepKey(props.node.data.turn, props.node.data.step)];
    const mode = presentation(row, props);
    // Group reasoning keeps the official renderer and disclosure behavior in every state.
    if (props.groupPart === 'reasoning' || mode === 'original') return <Default {...props} />;
    const data = props.node.data;
    if (mode === 'pending') {
      const withoutText = { ...props.node, data: { ...data, blocks: data.blocks.filter(block => block.kind !== 'text') } };
      const progress = row?.policyVersion === 2 ? row.status === 'collecting' ? '等待 A 完成回复…' : row.phase === 'reviewing' ? `B 正在核对完善（${row.reviewRound}/${row.reviewRounds}）…` : 'B 正在独立起草…' : '正在整理表达…';
      return <><Default {...props} node={withoutText} /><div role="status" aria-live="polite" style={hint}>{progress}</div></>;
    }
    if (mode === 'fallback') return <><Default {...props} /><div role="status" style={hint}>{row?.policyVersion === 2 ? 'B 回复未完成，已显示 A 原文。' : '整理未完成，已显示原文。'}</div></>;
    let inserted = false;
    const blocks = data.blocks.flatMap<AssistantBlock>(block => {
      if (block.kind !== 'text') return [block];
      if (inserted) return [];
      inserted = true;
      return [{ ...block, text: row!.rewrittenText! }];
    });
    return <div data-model-spokesperson="ready">
      <Default {...props} node={{ ...props.node, data: { ...data, blocks } }} />
      <div style={{ ...hint, display: 'flex', alignItems: 'center', gap: 10 }}><span>{row!.policyVersion === 2 ? `B 已独立作答${row!.reviewRounds ? ` · 已核对 ${row!.reviewRounds} 轮` : ''}` : '文字已整理'}</span>
        <button type="button" style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l1, #cbd5e1)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}
          onClick={() => { try { void navigator.clipboard.writeText(row!.rewrittenText!).then(() => setCopyState('已复制'), () => setCopyState('复制失败')); } catch { setCopyState('复制失败'); } }}>{copyState}</button>
      </div>
      <details style={hint}><summary style={{ cursor: 'pointer' }}>查看 A 的原文</summary><Default {...props} groupPart="response" /></details>
    </div>;
  };
}
