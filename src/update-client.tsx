import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { createElement } from 'react';
import { UpdateAction, type InstallOutcome } from './update-action.tsx';

interface ChangeResultLike {
  readonly application: InstallOutcome['application'];
  readonly version?: string;
  readonly error?: { readonly code?: string };
}

interface RemoteResultLike<T> {
  readonly ok: boolean;
  readonly value?: T;
}

interface PluginManagerRemote {
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<RemoteResultLike<ChangeResultLike>>;
}

/** Mount the bundle-detail update action; it owns no Host route because the repository is public. */
export function mountUpdateAction(ctx: Context) {
  ctx.effect(() => ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'model-spokesperson-update',
  }, (props: PluginDetailProps) => createElement(UpdateAction, {
    subject: props.subject,
    install: async (spec): Promise<InstallOutcome> => {
      try {
        const manager = (ctx.remote as unknown as { pluginManager?: PluginManagerRemote }).pluginManager;
        if (manager === undefined) return { application: 'failed', code: 'management-required' };
        const result = await manager.installBundle(spec, { enabled: true });
        if (!result.ok || result.value === undefined) return { application: 'failed', code: 'remote' };
        return {
          application: result.value.application,
          version: result.value.version,
          code: result.value.error?.code,
        };
      } catch {
        return { application: 'failed', code: 'remote' };
      }
    },
  }))));
}
