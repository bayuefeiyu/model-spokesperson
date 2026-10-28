import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types';
import { SettingsSchema, type Settings, type Route } from './contract.ts';
import { DRAFT_SYSTEM, REVIEW_SYSTEM } from './prompt.ts';

export interface SettingsViewProps { form: ConfigForm<Settings>; loadCatalog: () => Promise<ModelCatalog> }
const keyOf = (route: Route) => route.provider && route.model ? JSON.stringify([route.provider, route.model]) : '';
const fromKey = (key: string): Route => key ? { provider: JSON.parse(key)[0], model: JSON.parse(key)[1] } : { provider: '', model: '' };
const text: CSSProperties = { fontFamily: 'system-ui, sans-serif', fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary, #1e293b)' };
const control: CSSProperties = { font: 'inherit', color: 'inherit', background: 'var(--dsw-alias-background-primary, transparent)', border: '1px solid var(--dsw-alias-border-l1, #cbd5e1)', borderRadius: 8, padding: '8px 10px', width: '100%', boxSizing: 'border-box' };
const button: CSSProperties = { ...control, width: 'auto', cursor: 'pointer' };
const note: CSSProperties = { color: 'var(--dsw-alias-label-secondary, #64748b)', margin: '4px 0 12px' };

export function settingsError(value: Settings): string | undefined {
  const result = SettingsSchema.safeParse(value);
  if (result.success) return;
  const issue = result.error.issues[0];
  if (issue.path[0] === 'rules') return value.rules.some(rule => !keyOf(rule.source) || !keyOf(rule.writer)) ? '请为每组映射选择完整的 A 和 B 模型。' : issue.message;
  if (issue.path[0] === 'draftPrompt' || issue.path[0] === 'reviewPrompt') return issue.message;
  return issue.path[0] === 'style' ? '表达偏好不能超过 4000 字。' : '请检查高级设置的数值范围。';
}

/** A staged native ConfigForm editor: only Save writes, with the original revision fence. */
export function SettingsView({ form, loadCatalog }: SettingsViewProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form]);
  const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const current = useMemo(() => SettingsSchema.parse(snapshot.value ?? {}), [snapshot.value]);
  const [draft, setDraft] = useState<{ settings: Settings; revision: number | undefined }>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setCatalogStatus('loading');
    void Promise.resolve().then(loadCatalog).then(value => { if (active) { setCatalog(value); setCatalogStatus('ready'); } }, () => { if (active) setCatalogStatus('error'); });
    return () => { active = false; };
  }, [loadCatalog, refresh]);
  const value = draft?.settings ?? current;
  const dirty = JSON.stringify(value) !== JSON.stringify(current);
  const conflict = dirty && draft?.revision !== snapshot.revision;
  const invalid = settingsError(value);
  const writable = snapshot.status === 'ready' && snapshot.writable && !saving;
  function edit(change: (settings: Settings) => Settings) {
    setDraft(previous => ({ settings: change(previous?.settings ?? structuredClone(current)), revision: previous ? previous.revision : snapshot.revision }));
    setMessage(''); setError('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!writable || !dirty || !draft || invalid || conflict) return;
    const desired = SettingsSchema.parse(value);
    const ops = (Object.keys(desired) as (keyof Settings)[]).filter(key => JSON.stringify(desired[key]) !== JSON.stringify(current[key])).map(key => ({ op: 'set' as const, path: [key], value: desired[key] }));
    setSaving(true); setMessage(''); setError('');
    try {
      const accepted = await form.mutate(ops, draft.revision);
      if (!alive.current) return;
      if (accepted) { setDraft(undefined); setMessage('已保存，下一次回复将使用新设置。'); }
      else setError('保存未成功，修改仍已保留。请检查是否有其他页面或配置文件同时更新。');
    } catch { if (alive.current) setError('保存失败，修改仍已保留。请检查连接后重试。'); }
    finally { if (alive.current) setSaving(false); }
  }
  if (snapshot.status !== 'ready') return <p role="status" style={text}>{snapshot.status === 'loading' ? '正在读取模型嘴替设置…' : '配置暂不可用，请确认 Host 组件已启用。'}</p>;
  const groups = catalog?.groups ?? [];
  function selector(route: Route, label: string, change: (route: Route) => void) {
    const found = groups.some(group => group.id === route.provider && group.models.some(model => model.id === route.model));
    return <label style={{ display: 'grid', gap: 5 }}>{label}
      <select aria-label={label} style={control} value={keyOf(route)} onChange={event => change(fromKey(event.target.value))}>
        <option value="">请选择模型</option>
        {keyOf(route) && !found && <option value={keyOf(route)}>{route.provider} / {route.model}（当前不在模型列表中）</option>}
        {groups.map(group => <optgroup key={group.id} label={`${group.name} · ${group.id}`}>{group.models.map(model => <option key={model.id} value={keyOf({ provider: group.id, model: model.id })}>{group.name} / {model.name}{model.name !== model.id ? ` · ${model.id}` : ''}</option>)}</optgroup>)}
      </select>
    </label>;
  }
  return <form aria-label="模型嘴替设置" noValidate onSubmit={event => void save(event)} style={{ ...text, padding: '18px 0', display: 'grid', gap: 16 }}>
    <div><h3 style={{ margin: 0, fontSize: 16 }}>模型与表达</h3><p style={note}>A 负责分析和执行，B 根据工作上下文独立作答，再参考 A 的报告核对自己的初稿。</p></div>
    {!snapshot.writable && <p role="status" style={note}>当前部署的配置为只读。</p>}
    <fieldset disabled={!writable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 16 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={value.enabled} onChange={event => edit(settings => ({ ...settings, enabled: event.target.checked }))} />开启 B 回复</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={note}>{catalogStatus === 'loading' ? '正在读取模型列表…' : catalogStatus === 'error' ? '模型列表读取失败，已保留当前配置。' : groups.length === 0 ? '没有可选模型，请先在 DSH 的“设置 → 模型”中配置。' : '从 DSH 已配置的模型中选择。'}{catalog?.failures.length ? ' 部分提供方暂时不可用，已有选择不会被清除。' : ''}</span>
        <button type="button" style={button} onClick={() => setRefresh(value => value + 1)} disabled={catalogStatus === 'loading'}>刷新模型列表</button>
      </div>
      {value.rules.map((rule, index) => <fieldset key={index} style={{ border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)', borderRadius: 10, padding: 14, margin: 0, minWidth: 0 }}>
        <legend>模型映射 {index + 1}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {selector(rule.source, `第 ${index + 1} 组 A 模型（完成工作）`, route => edit(settings => ({ ...settings, rules: settings.rules.map((item, i) => i === index ? { ...item, source: route } : item) })))}
          {selector(rule.writer, `第 ${index + 1} 组 B 模型（独立作答）`, route => edit(settings => ({ ...settings, rules: settings.rules.map((item, i) => i === index ? { ...item, writer: route } : item) })))}
        </div>
        <button type="button" style={{ ...button, marginTop: 12 }} onClick={() => edit(settings => ({ ...settings, rules: settings.rules.filter((_, i) => i !== index) }))}>删除第 {index + 1} 组映射</button>
      </fieldset>)}
      <div><button type="button" style={button} onClick={() => edit(settings => ({ ...settings, rules: [...settings.rules, { source: { provider: '', model: '' }, writer: { provider: '', model: '' } }] }))}>添加模型映射</button></div>
      <label style={{ display: 'grid', gap: 5 }}>表达偏好<textarea aria-label="表达偏好" rows={3} style={control} value={value.style} onChange={event => edit(settings => ({ ...settings, style: event.target.value }))} /></label>
      <details><summary style={{ cursor: 'pointer' }}>提示词设置</summary><div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
        <p style={note}>以下是发送给 B 的完整阶段提示词，可直接修改。每次调用还会在末尾附加上面的“表达偏好”。恢复默认只修改当前草稿，点击“保存设置”后生效。</p>
        <label style={{ display: 'grid', gap: 5 }}>独立起草提示词<textarea aria-label="独立起草提示词" rows={12} spellCheck={false} style={{ ...control, resize: 'vertical' }} value={value.draftPrompt} onChange={event => edit(settings => ({ ...settings, draftPrompt: event.target.value }))} /></label>
        <div><button type="button" style={button} onClick={() => edit(settings => ({ ...settings, draftPrompt: DRAFT_SYSTEM }))}>恢复默认起草提示词</button></div>
        <p style={note}>起草输入为 JSON：userQuestion 是用户本次要求，workContext 是 A 写本次报告前的工作材料；不包含 A 本次成稿。</p>
        <label style={{ display: 'grid', gap: 5 }}>核对完善提示词<textarea aria-label="核对完善提示词" rows={14} spellCheck={false} style={{ ...control, resize: 'vertical' }} value={value.reviewPrompt} onChange={event => edit(settings => ({ ...settings, reviewPrompt: event.target.value }))} /></label>
        <div><button type="button" style={button} onClick={() => edit(settings => ({ ...settings, reviewPrompt: REVIEW_SYSTEM }))}>恢复默认核对提示词</button></div>
        <p style={note}>核对输入还包含 ownDraft（B 自己的上一稿）、sourceReport（A 的参考报告）、reviewRound（当前核对轮次）。这些字段由插件提供，无需填写占位符。核对轮数为 0 时不使用核对提示词。</p>
      </div></details>
      <label style={{ display: 'grid', gap: 5 }}>核对轮数<input aria-label="核对轮数" type="number" min={0} step={1} style={control} value={value.reviewRounds} onChange={event => edit(settings => ({ ...settings, reviewRounds: Number(event.target.value) }))} /><span style={note}>先独立起草，再核对 {value.reviewRounds} 轮，共调用 B {value.reviewRounds + 1} 次。设为 0 时只独立起草，不向 B 提供 A 本次报告。每轮核对都在 B 自己的上一稿上完善。</span></label>
      <details><summary style={{ cursor: 'pointer' }}>高级设置</summary><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 12 }}>
        {([{ key: 'timeoutMs', label: '完整流程超时（秒，0 不限）', scale: 1000, min: 0, max: 2147483.647 }, { key: 'maxConcurrentRewrites', label: '同时处理数量', scale: 1, min: 1, max: 16 }, { key: 'maxInputChars', label: '每次输入字符上限（0 不限）', scale: 1, min: 0, max: Number.MAX_SAFE_INTEGER }, { key: 'maxOutputTokens', label: '每次输出 tokens（0 跟随模型）', scale: 1, min: 0, max: Number.MAX_SAFE_INTEGER }] as const).map(field => <label key={field.key} style={{ display: 'grid', gap: 5 }}>{field.label}<input aria-label={field.label} type="number" step={field.key === 'timeoutMs' ? 'any' : 1} min={field.min} max={field.max} style={control} value={value[field.key] / field.scale} onChange={event => edit(settings => ({ ...settings, [field.key]: Number(event.target.value) * field.scale }))} /></label>)}
      </div><p style={note}>插件默认不额外限制输入和等待时间，输出上限跟随 B 的模型配置；实际仍受模型及提供方限制。旧设置中的限额会保留，可改为 0。每次输入包含工作上下文，核对时还包含 B 的上一稿和 A 的报告；超过自设上限会回退，不会静默截断。</p></details>
    </fieldset>
    <p style={note}>聊天时仍在输入框选择 A，这里不会自动切换会话模型。保存只影响后续回复，进行中的流程保留原设置。B 会增加调用费用和等待时间；核对失败会显示 A 原文。没有匹配到 A 的模型直接显示。</p>
    {invalid && dirty && <p role="alert" style={{ margin: 0, color: 'var(--dsw-alias-state-error-primary, #b91c1c)' }}>{invalid}</p>}
    {conflict && <p role="alert">设置已在其他页面或配置文件中改变。请先放弃当前修改，读取最新值后再保存。</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" style={{ margin: 0 }}>{message}</p>}
    <div style={{ display: 'flex', gap: 10 }}>
      <button type="submit" style={{ ...button, background: 'var(--dsw-alias-fill-brand-primary, #2563eb)', color: '#fff', opacity: !writable || !dirty || !!invalid || conflict ? 0.5 : 1 }} disabled={!writable || !dirty || !!invalid || conflict}>{saving ? '保存中…' : '保存设置'}</button>
      <button type="button" style={{ ...button, opacity: !dirty || saving ? 0.5 : 1 }} disabled={!dirty || saving} onClick={() => { setDraft(undefined); setMessage(''); setError(''); }}>放弃修改</button>
    </div>
  </form>;
}
