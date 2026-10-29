import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { UPDATE_PACKAGE, UpdateCheckError, fetchLatestRelease, isNewer, type LatestRelease } from './update.ts';

export type UpdateApplication = 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';

export interface InstallOutcome {
  readonly application: UpdateApplication;
  readonly version?: string;
  readonly code?: string;
}

export interface UpdateActionProps {
  readonly subject: PluginDetailProps['subject'];
  readonly check?: (force?: boolean) => Promise<LatestRelease>;
  readonly install?: (spec: string) => Promise<InstallOutcome>;
  readonly reload?: () => void;
}

type Phase = 'checking' | 'current' | 'available' | 'updating' | 'done' | 'restart' | 'error';

const wrap: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  lineHeight: 1.4,
};
const button: CSSProperties = {
  font: 'inherit',
  color: 'var(--dsw-alias-label-primary, #1e293b)',
  background: 'var(--dsw-alias-background-primary, transparent)',
  border: '1px solid var(--dsw-alias-border-l1, #cbd5e1)',
  borderRadius: 8,
  padding: '4px 10px',
  cursor: 'pointer',
};
const disabledButton: CSSProperties = { ...button, cursor: 'default', opacity: 0.65 };
const note: CSSProperties = { color: 'var(--dsw-alias-label-secondary, #64748b)' };
const errorText: CSSProperties = { ...note, color: 'var(--dsw-alias-state-error-primary, #b91c1c)' };

const defaultCheck = (force = false) => fetchLatestRelease({ force });
const reloadPage = () => {
  if (typeof window !== 'undefined') window.location.reload();
};

function currentVersion(subject: PluginDetailProps['subject']): string | undefined {
  return subject.kind === 'bundle' ? subject.pkg.version : undefined;
}

function checkMessage(error: unknown): string {
  return error instanceof UpdateCheckError ? error.message : '检查更新失败，请稍后重试。';
}

function installMessage(outcome: InstallOutcome): string {
  switch (outcome.code) {
    case 'already-installed': return '已安装该版本，无需重复更新。';
    case 'incompatible-version': return '新版本与当前 DSH 版本不兼容，未安装。';
    case 'not-found': return '没有找到该版本的安装来源。';
    case 'network': return '无法访问 GitHub，原版本仍保留。';
    case 'build-blocked': return '依赖脚本审批阻止了安装，请先在插件管理器处理。';
    case 'management-required': return '当前 profile 没有可用的插件管理器。';
    case 'ambiguous-install': return '安装结果不明确，请在插件管理器检查。';
    case 'operation-error': return '安装失败，原版本仍保留。';
    case 'remote': return '更新请求未送达 Host，请检查连接后重试。';
    default: return outcome.application === 'cancelled' ? '更新已取消，原版本仍保留。' : '更新失败，原版本仍保留。';
  }
}

/**
 * A compact update control for the plugin manager's `plugins.detail.actions`
 * slot. It renders only for this bundle; the page's own uninstall and enable
 * controls remain untouched.
 */
export function UpdateAction({ subject, check = defaultCheck, install, reload = reloadPage }: UpdateActionProps) {
  const current = currentVersion(subject);
  const eligible = subject.kind === 'bundle' && subject.pkg.name === UPDATE_PACKAGE && subject.pkg.installed;
  const [phase, setPhase] = useState<Phase>('checking');
  const [release, setRelease] = useState<LatestRelease>();
  const [message, setMessage] = useState('');
  const [installedVersion, setInstalledVersion] = useState<string>();
  const alive = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!eligible || settled.current) return;
    let active = true;
    setPhase('checking');
    setMessage('');
    void check(false).then(value => {
      if (!active || !alive.current) return;
      setRelease(value);
      setPhase(current !== undefined && !isNewer(current, value.version) ? 'current' : 'available');
    }, error => {
      if (!active || !alive.current) return;
      setPhase('error');
      setMessage(checkMessage(error));
    });
    return () => { active = false; };
  }, [eligible, current, check]);

  if (!eligible) return null;

  function retryCheck() {
    setPhase('checking');
    setMessage('');
    setRelease(undefined);
    void check(true).then(value => {
      if (!alive.current) return;
      setRelease(value);
      setPhase(current !== undefined && !isNewer(current, value.version) ? 'current' : 'available');
    }, error => {
      if (!alive.current) return;
      setPhase('error');
      setMessage(checkMessage(error));
    });
  }

  async function startUpdate() {
    if (release === undefined || install === undefined) {
      setPhase('error');
      setMessage('更新服务暂不可用，请刷新页面后重试。');
      return;
    }
    setPhase('updating');
    setMessage('');
    try {
      const outcome = await install(release.assetUrl);
      if (!alive.current) return;
      const version = outcome.version ?? release.version;
      setInstalledVersion(version);
      if (outcome.application === 'applied') {
        settled.current = true;
        setPhase('done');
        setMessage('');
      } else if (outcome.application === 'restart-required') {
        settled.current = true;
        setPhase('restart');
      } else if (outcome.application === 'overridden') {
        settled.current = true;
        setPhase('done');
        setMessage('已安装，但启用状态被更高层配置覆盖。');
      } else {
        setPhase('error');
        setMessage(installMessage(outcome));
      }
    } catch {
      if (!alive.current) return;
      setPhase('error');
      setMessage('更新请求失败，请检查连接后重试。');
    }
  }

  if (phase === 'checking') {
    return <span style={wrap} role="status"><button type="button" style={disabledButton} disabled>检查更新…</button></span>;
  }
  if (phase === 'updating') {
    return <span style={wrap} role="status"><button type="button" style={disabledButton} disabled>更新中…</button><span style={note}>正在安装</span></span>;
  }
  if (phase === 'done') {
    return <span style={wrap}>
      <button type="button" style={button} onClick={reload}>刷新页面</button>
      <span style={note}>{message || `已更新到 v${installedVersion ?? release?.version ?? ''}`}</span>
    </span>;
  }
  if (phase === 'restart') {
    return <span style={wrap} role="status"><span style={note}>已安装 v{installedVersion ?? release?.version ?? ''}，重启 DSH 后生效。</span></span>;
  }
  if (phase === 'error') {
    return <span style={wrap}>
      <button type="button" style={button} onClick={release === undefined ? retryCheck : startUpdate}>{release === undefined ? '重试检查' : '重试更新'}</button>
      <span style={errorText} role="alert">{message}</span>
    </span>;
  }
  if (phase === 'available' && release !== undefined) {
    return <span style={wrap}>
      <button type="button" style={button} aria-label={`更新到 v${release.version}`} onClick={startUpdate}>更新到 v{release.version}</button>
      <span style={note}>当前 v{current ?? '未知'}</span>
    </span>;
  }
  return <span style={wrap}>
    <button type="button" style={button} title="重新检查更新" onClick={retryCheck}>已是最新{current === undefined ? '' : ` v${current}`}</button>
  </span>;
}
