import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { UpdateAction, type InstallOutcome } from '../src/update-action.tsx';
import { UPDATE_PACKAGE, UpdateCheckError, type LatestRelease } from '../src/update.ts';

const release = (version: string): LatestRelease => ({
  version,
  tag: `v${version}`,
  htmlUrl: `https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v${version}`,
  assetName: `dsh-plugins-model-spokesperson-${version}.tgz`,
  assetUrl: `https://github.com/bayuefeiyu/model-spokesperson/releases/download/v${version}/dsh-plugins-model-spokesperson-${version}.tgz`,
  checkedAt: 1,
});

const subject = (version = '0.2.2', name = UPDATE_PACKAGE): PluginDetailProps['subject'] => ({
  kind: 'bundle',
  pkg: {
    name,
    version,
    installed: true,
    availability: 'profile',
    official: false,
    enabled: true,
    rows: [],
  },
});

const label = (node: ReactTestInstance) => node.children.filter(value => typeof value === 'string').join('');
const button = (root: ReactTestInstance, text: string) => root.findAllByType('button').find(node => label(node) === text);

test('an available update installs the new tag and offers a browser refresh', async () => {
  let installedSpec = '';
  let reloaded = false;
  const install = async (spec: string): Promise<InstallOutcome> => {
    installedSpec = spec;
    return { application: 'applied', version: '0.2.3' };
  };
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction subject={subject('0.2.2')} check={async () => release('0.2.3')} install={install} reload={() => { reloaded = true; }} />);
  });
  const update = button(view!.root, '更新到 v0.2.3');
  assert.ok(update);
  await act(async () => { await update.props.onClick(); });
  assert.equal(installedSpec, 'https://github.com/bayuefeiyu/model-spokesperson/releases/download/v0.2.3/dsh-plugins-model-spokesperson-0.2.3.tgz');
  const refresh = button(view!.root, '刷新页面');
  assert.ok(refresh);
  act(() => refresh.props.onClick());
  assert.equal(reloaded, true);
  view!.unmount();
});

test('an update that needs a restart reports it without offering a reload', async () => {
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction subject={subject('0.2.2')} check={async () => release('0.2.3')} install={async () => ({ application: 'restart-required', version: '0.2.3' })} />);
  });
  const update = button(view!.root, '更新到 v0.2.3');
  assert.ok(update);
  await act(async () => { await update.props.onClick(); });
  assert.ok(view!.root.findAllByType('span').some(node => label(node).includes('重启 DSH 后生效')));
  assert.equal(button(view!.root, '刷新页面'), undefined);
  view!.unmount();
});

test('a failed install keeps the original version and exposes a retry', async () => {
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction
      subject={subject('0.2.2')}
      check={async () => release('0.2.3')}
      install={async () => ({ application: 'failed', code: 'incompatible-version' })}
    />);
  });
  const update = button(view!.root, '更新到 v0.2.3');
  assert.ok(update);
  await act(async () => { await update.props.onClick(); });
  assert.ok(view!.root.findAllByProps({ role: 'alert' }).some(node => label(node).includes('不兼容')));
  assert.ok(button(view!.root, '重试更新'));
  view!.unmount();
});

test('a failed check reports the reason and can be retried', async () => {
  let attempts = 0;
  const check = async () => {
    attempts += 1;
    if (attempts === 1) throw new UpdateCheckError('network', '无法连接 GitHub，请检查网络后重试。');
    return release('0.2.2');
  };
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction subject={subject('0.2.2')} check={check} install={async () => ({ application: 'applied' })} />);
  });
  assert.ok(view!.root.findAllByProps({ role: 'alert' }).some(node => label(node).includes('无法连接 GitHub')));
  const retry = button(view!.root, '重试检查');
  assert.ok(retry);
  await act(async () => { await retry.props.onClick(); });
  assert.ok(button(view!.root, '已是最新 v0.2.2'));
  view!.unmount();
});

test('the action renders only for this installed bundle', async () => {
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction subject={subject('0.2.2', '@other/plugin')} check={async () => release('0.2.3')} install={async () => ({ application: 'applied' })} />);
  });
  assert.equal(view!.toJSON(), null);
  view!.unmount();
});

test('an up-to-date bundle still offers a fresh manual check', async () => {
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(<UpdateAction subject={subject('0.2.2')} check={async () => release('0.2.2')} install={async () => ({ application: 'applied' })} />);
  });
  assert.ok(button(view!.root, '已是最新 v0.2.2'));
  view!.unmount();
});
