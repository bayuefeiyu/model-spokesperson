import { routeEquals, type Rewrite, type Settings } from './contract.ts';
import type { WorkContext } from './work-context.ts';
import { validateReport } from './policy.ts';

export function stageRequest(settings: Settings, context: WorkContext, originalText: string, round: number, ownDraft?: string) {
  return { system: (round === 0 ? settings.draftPrompt : settings.reviewPrompt) + '\n表达偏好：' + settings.style,
    input: JSON.stringify(round === 0 ? context : { ...context, ownDraft, sourceReport: originalText, reviewRound: round }) };
}

/** Reuse only complete outputs from the exact same route, prompt and input chain. */
export function completedPrefix(row: Rewrite, settings: Settings, context: WorkContext): number[] {
  const stages = row.stages ?? [];
  const indices: number[] = [];
  let ownDraft: string | undefined;
  for (let round = 0; round <= settings.reviewRounds; round++) {
    const request = stageRequest(settings, context, row.originalText!, round, ownDraft);
    const index = stages.findLastIndex(stage => stage.round === round && stage.kind === (round === 0 ? 'draft' : 'review') &&
      stage.finishedAt !== undefined && stage.output && !validateReport(stage.output) && routeEquals(stage.writer ?? row.writer, row.writer) && stage.system === request.system && stage.input === request.input);
    if (index < 0) break;
    indices.push(index); ownDraft = stages[index].output;
  }
  return indices;
}

export function hasCompletedFinal(row: Rewrite): boolean {
  if (!row.rewrittenText || validateReport(row.rewrittenText)) return false;
  const stages = row.stages ?? [];
  const indices = row.activeStages ?? stages.map((_stage, index) => index);
  return indices.length === (row.reviewRounds ?? 1) + 1 && indices.every((index, round) => {
    const stage = stages[index];
    return stage?.round === round && stage.kind === (round === 0 ? 'draft' : 'review') && stage.finishedAt !== undefined && !!stage.output && !validateReport(stage.output);
  }) && stages[indices.at(-1)!]?.output === row.rewrittenText;
}
