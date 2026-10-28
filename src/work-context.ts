import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { z } from 'zod';
import type { RewriteProjection, WorkContextSchema } from './contract.ts';

export type WorkContext = z.infer<typeof WorkContextSchema>;
export type WorkMessage = WorkContext['workContext'][number];

function material(block: ContentBlock): WorkMessage['content'] {
  switch (block.type) {
    case 'text': return [{ type: 'text', text: block.text }];
    case 'tool-call': return [{ type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }];
    // Attachments are evidence references, not file/image bytes that B has inspected.
    case 'image': case 'file': return [{ type: block.type, availableContent: false, note: '附件内容未提供；只可依据工作记录中实际读取的内容。' }];
    default: return []; // No hidden reasoning, provider replay state or tool schema updates.
  }
}

/** Capture at assistant attempt start, before this attempt's report exists. */
export function captureWorkContext(messages: readonly Message[], rows: RewriteProjection): WorkContext {
  const displayed = new Map(Object.values(rows).filter(row => row.status === 'ready' && row.originalMessageId && row.rewrittenText).map(row => [row.originalMessageId!, row]));
  let userQuestion = '';
  const workContext: WorkMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer' || message.source.kind === 'model-spokesperson') continue;
    if (message.role === 'user' && message.source.kind === 'user') userQuestion = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    const saved = displayed.get(message.id);
    const original = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    const useDisplayed = message.role === 'assistant' && saved?.originalText === original;
    const content = useDisplayed ? [{ type: 'text', text: saved!.rewrittenText! }] : message.content.flatMap(material);
    if (!content.length) continue;
    workContext.push({ role: message.role, source: useDisplayed ? 'B-previous-reply' : message.source.kind,
      content, ...(message.role === 'tool' ? { callId: message.toolCallId, isError: message.isError ?? false } : {}) });
  }
  return { userQuestion, workContext };
}
