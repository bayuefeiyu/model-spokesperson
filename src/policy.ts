/** Independent reports may change ordering/wording. Factual review is an LLM task. */
export function validateReport(text: string): string | undefined {
  return text.trim() ? undefined : 'empty-output';
}

/** Legacy v1 recovery only; never constrain independent reports against A's wording. */
export function skipText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(```|~~~)[\s\S]*\1$/.test(trimmed)) return true;
  try { const value = JSON.parse(trimmed); if (value !== null && typeof value === 'object') return true; } catch {}
  return false;
}

function matches(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), item => item[0]);
}
function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
export function validateRewrite(original: string, rewritten: string): string | undefined {
  if (!rewritten.trim()) return 'empty-output';
  const guards: [string, RegExp][] = [
    ['code-blocks', /```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g],
    ['inline-code', /`[^`\n]+`/g],
    ['links', /\]\([^\s)]+(?:\s+"[^"]*")?\)|https?:\/\/[^\s<>\])]+/g],
    ['paths', /[A-Za-z]:[\\/][^\s`<>"'，。；）]+|(?:\.{0,2}\/)[\w.\-/]+/g],
    ['numbers', /[-+]?\d+(?:[.,]\d+)*(?:%|％)?/g],
    ['citations', /\[\d+\]|【[^】]+】/g],
  ];
  for (const [name, pattern] of guards) {
    // Preserve occurrence counts as well as values; ordering is significant for numbered options.
    const a = matches(original, pattern), b = matches(rewritten, pattern);
    if (!same(a, b)) return `protected-${name}`;
  }
  const options = /^(?:\s*)(?:\d+[.)、]|[A-Z][.)、]|[一二三四五六七八九十]+[、.）])/gm;
  if (!same(matches(original, options).map(v => v.trim()), matches(rewritten, options).map(v => v.trim()))) return 'protected-options';
  if (/[?？]\s*$/.test(original.trim()) && !/[?？]\s*$/.test(rewritten.trim())) return 'question-lost';
  // These status markers are too important to rely on stylistic prompting alone.
  for (const marker of ['尚未验证', '未验证', '未经验证', '未测试', '尚未完成', '未完成', '失败', '不确定', '不能', '不得', '不支持', '不可', '无法', '没有']) {
    if (original.includes(marker) && !rewritten.includes(marker)) return 'protected-status';
  }
  return undefined;
}
