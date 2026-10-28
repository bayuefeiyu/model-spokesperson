import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import { createElement } from 'react';
import { SETTINGS_NS, type Settings } from './contract.ts';
import { SettingsView } from './settings-view.tsx';

export function mountSettings(ctx: Context) {
  const form = ctx.configForms.get<Settings>(SETTINGS_NS);
  const loadCatalog = async () => {
    const result = await ctx.remote.session.modelCatalog();
    if (!result.ok) throw new Error('模型列表暂不可用');
    return result.value;
  };
  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@dsh-plugins/model-spokesperson',
  }, () => createElement(SettingsView, { form, loadCatalog })))));
}
