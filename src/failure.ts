import type { Rewrite, Settings } from './contract.ts';

export function inputBudget(settings: Settings, request: { system: string; input: string }) {
  const chars = request.system.length + request.input.length;
  return settings.maxInputChars > 0 && chars > settings.maxInputChars ? { chars, limit: settings.maxInputChars } : undefined;
}

export function inputLimitMessage(budget?: Rewrite['inputBudget']) {
  const detail = budget ? `本次 B 输入为 ${budget.chars.toLocaleString('en-US')} 个字符，超过设置上限 ${budget.limit.toLocaleString('en-US')} 个字符。` : '本次 B 输入超过插件设置的字符上限。';
  return `${detail}请在插件“高级设置”中调大“每次输入字符上限”，或设为 0（不限），保存后重试。此处按字符数计量，与模型的 token 上下文窗口不同。`;
}

/** Only known, safe reason codes become UI text; provider exception text stays private. */
export function failureMessage(row: Rewrite) {
  if (row.reason === 'input-limit') return inputLimitMessage(row.inputBudget);
  if (row.policyVersion === 3) {
    switch (row.reason) {
      case 'timeout': return 'B 翻译超时，请检查“完整流程超时”设置后重试。';
      case 'writer-incomplete': return 'B 翻译未正常完成输出，请检查输出预算或模型服务后重试。';
      case 'empty-output': return 'B 未返回有效译文，请重试或检查 B 模型设置。';
      case 'writer-or-storage-error': return 'B 翻译调用或记录保存失败，请检查 B 模型服务及连接后重试。';
      case 'translation-rule-missing': return '本步没有生效的英文底稿规则（可能被完整提示预设覆盖），已显示 A 原文。';
      case 'translation-route-changed': return '本步实际模型与英文底稿规则不一致，已跳过翻译并显示 A 原文。';
      default: return row.status === 'cancelled' ? 'B 翻译已取消，可在 A 空闲时重试。' : 'B 翻译失败，可重试或检查 B 模型设置。';
    }
  }
  switch (row.reason) {
    case 'timeout': return 'B 处理超时，请检查“完整流程超时”设置后重试。';
    case 'writer-incomplete': return 'B 未正常完成输出，请检查输出预算或模型服务后重试。';
    case 'empty-output': return 'B 未返回有效正文，请重试或检查 B 模型设置。';
    case 'writer-or-storage-error': return 'B 调用或记录保存失败，请检查 B 模型服务及连接后重试。';
    case 'interrupted-rewrite': return '上次 B 处理被重启或重载中断，可重试继续。';
    default: return row.status === 'cancelled' ? 'B 处理已取消，可在 A 空闲时重试。' : 'B 处理失败，可重试或检查 B 模型设置。';
  }
}
