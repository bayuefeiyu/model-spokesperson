import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const runtime = resolve(root, '.dev/runtime');
const profileName = process.argv[2] ?? 'spokesperson-dev';
if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) throw new Error('Invalid test profile name');
const profile = resolve(root, '.dev/runtime/spokesperson-home/profiles', profileName);
const emptySettings = process.argv.includes('--empty-settings');
await mkdir(profile, { recursive: true });
await writeFile(resolve(runtime, 'spokesperson-mock.mjs'), `
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { appendFile, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
export const inject = ['llm'];
export function apply(ctx) {
  class Mock extends LlmAdapter {
    providerInfo(id) { return {id,name:'Spokesperson mock（不调用 API）'}; }
    async listModels(provider) { return ['a','b','c'].map(id => ({provider,id,name:'Mock '+id.toUpperCase(),inputModalities:['text']})); }
    async *stream(options) {
      await appendFile(${JSON.stringify(resolve(root, '.dev/workspace/calls.jsonl'))}, JSON.stringify({model:options.model,loop:isAgentLoopRequest(options),purpose:options.purpose ?? null,messages:options.messages,system:options.system,maxTokens:options.maxTokens})+'\\n');
      if (options.model === 'b') {
        await delay(1000,undefined,{signal:options.signal});
        const data = JSON.parse(options.messages[0].content[0].text);
        if ((data.userQuestion.includes('retry-review-once') && data.reviewRound===1 && data.ownDraft) || (data.userQuestion.includes('retry-draft-once') && !data.ownDraft)) {
          const count = (await readFile(${JSON.stringify(resolve(root, '.dev/workspace/calls.jsonl'))},'utf8')).trim().split(String.fromCharCode(10)).filter(line => {
            try { const call=JSON.parse(line); if(call.model!=='b')return false; const input=JSON.parse(call.messages[0].content[0].text); return input.userQuestion===data.userQuestion && input.reviewRound===data.reviewRound && !!input.ownDraft===!!data.ownDraft; } catch { return false; }
          }).length;
          if (count===1) throw new Error('mock transient failure');
        }
        if (data.userQuestion.includes('fail') && (!data.userQuestion.includes('review-fail') || data.ownDraft)) throw new Error('mock failure');
        yield {type:'text-delta',index:0,text:'建议采用第一种实现。'};
      } else {
        yield {type:'reasoning-delta',index:0,text:'只供验证的思考。'};
        yield {type:'text-delta',index:1,text:options.model === 'c' ? 'C 自己的回答。' : '针对当前事项，综合考量后建议采用第一种实现。'};
        await delay(250,undefined,{signal:options.signal});
      }
      yield {type:'usage',usage:{inputTokens:20,outputTokens:10}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['spokesperson-mock'],new Mock());
}
`);
const mock = resolve(runtime, 'spokesperson-mock.mjs').replaceAll('\\', '/');
if (process.argv.includes('--mock-only')) { console.log('Prepared API-free mock module; existing profile preserved.'); process.exit(0); }
const hostSettings = emptySettings ? '    enabled: false\n    rules: []' : `    enabled: true
    rules:
      - source: { provider: spokesperson-mock, model: a }
        writer: { provider: spokesperson-mock, model: b }`;
await writeFile(resolve(profile, 'cordis.patch.yml'), `
- id: model-spokesperson-host
  config:
${hostSettings}
- id: agent-default-model
  config: { provider: spokesperson-mock, model: a }
- id: session-telemetry-otel
  disabled: true
- id: session-title-llm
  disabled: true
- id: workspace-controller
  config:
    documentsDirectory: '${resolve(root, '.dev/documents').replaceAll('\\', '/')}'
- insert:
    - id: spokesperson-mock
      name: '${mock}'
`);
console.log('Prepared isolated, API-free mock profile: ' + profile);
