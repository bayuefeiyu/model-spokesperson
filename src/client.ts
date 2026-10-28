import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { createElement, type ComponentType } from 'react';
import { createAssistantView, type AssistantProps } from './presentation.tsx';

export const inject = ['slots'];
const children = {
  'conversation.chat.reasoning.body': 'model-spokesperson.reasoning.body',
  'conversation.chat.message.images': 'model-spokesperson.message.images',
} as const;
/** Wrap the live official registration; preserve all of its declared children and injected capabilities. */
export function apply(ctx: Context) {
  let own: (() => void) | undefined;
  let base: StoredEntry | undefined;
  let changing = false;
  function reconcile() {
    if (changing) return;
    // Packaged clients minify fiber names, so registrant is diagnostic only.
    // The official renderer owns these two public child slots; our wrapper reuses them.
    const original = ctx.slots.entries('conversation.chat.node').find(entry =>
      entry.options.key === 'assistant-step' &&
      entry.children?.['conversation.chat.reasoning.body'] && entry.children?.['conversation.chat.message.images']);
    if (original === base) return;
    changing = true;
    try {
      own?.(); own = undefined; base = original;
      if (!original) return;
      const Default = original.component as ComponentType<AssistantProps>;
      // Child-slot authorization belongs to a registration. Declare private aliases and
      // mirror the official leaf registrations instead of stealing their declarations.
      const Delegate = (props: AssistantProps) => createElement(Default, {
        ...props, renderSlot: (key: keyof typeof children, owner: unknown, options: unknown) =>
          (props.renderSlot as unknown as (key: string, owner: unknown, options: unknown) => unknown)(children[key], owner, options),
      } as AssistantProps);
      const View = createAssistantView(Delegate);
      // The public inspection surface erases registration types. This boundary reuses the
      // inspected registration unchanged except for the wrapper and its shadowing rank.
      const register = ctx.slots.register as unknown as (options: Record<string, unknown>, component: ComponentType<AssistantProps>) => () => void;
      const dispose = register.call(ctx.slots, {
        name: 'conversation.chat.node', key: 'assistant-step',
        priority: (original.options.priority ?? 0) - 10,
        locale: original.locale, inject: original.inject,
        children: Object.fromEntries(Object.entries(children).map(([source, target]) => [target, original.children![source]])),
      }, View);
      const mirrors = Object.entries(children).map(([source, target]) => {
        let entries: readonly StoredEntry[] | undefined;
        let undo: (() => void)[] = [];
        const sync = () => {
          const current = ctx.slots.entries(source as keyof typeof children);
          if (current === entries) return;
          for (const stop of undo) stop();
          undo = []; entries = current;
          for (const entry of current) {
            // The pinned shipped child renderers are leaves. A third-party renderer with
            // its own child declarations requires a separate integration.
            if (entry.children) continue;
            undo.push(register.call(ctx.slots, { name: target, ...entry.options,
              locale: entry.locale, inject: entry.inject, store: entry.store, select: entry.select,
            }, entry.component as ComponentType<AssistantProps>));
          }
        };
        const stop = ctx.slots.subscribe(source as keyof typeof children, sync);
        sync();
        return () => { stop(); for (const remove of undo) remove(); };
      });
      own = () => { for (const stop of mirrors) stop(); dispose(); };
    } finally { changing = false; }
  }
  ctx.effect(() => {
    const unsubscribe = ctx.slots.subscribe('conversation.chat.node', reconcile);
    reconcile();
    return () => { unsubscribe(); own?.(); base = undefined; };
  });
}
