import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsSchema } from '../src/contract.ts';
import { validateRewrite } from '../src/policy.ts';
import { RewriteQueue } from '../src/queue.ts';
import { setTimeout as delay } from 'node:timers/promises';

test('critical content, options and status cannot silently change', () => {
  const original = '尚未验证。\n1. 运行 `npm test`，费用 10 元。\n2. 查看 [文档](https://example.com/a)。\n你选哪项？';
  assert.equal(validateRewrite(original, original), undefined);
  for (const [from, to] of [['尚未验证', '已通过'], ['npm test', 'npm install'], ['10', '12'], ['/a', '/b'], ['1.', '3.'], ['？', '。']]) {
    assert.ok(validateRewrite(original, original.replace(from, to)));
  }
  assert.equal(validateRewrite('费用10元，尚未完成。', '费用12元，尚未完成。'), 'protected-numbers');
  assert.equal(validateRewrite('功能不支持，未验证。', '功能支持，已验证。'), 'protected-status');
});
test('config rejects ambiguous routing and invalid limits', () => {
  assert.equal(SettingsSchema.parse({}).enabled, false);
  assert.equal(SettingsSchema.safeParse({ enabled: true }).success, false);
  assert.equal(SettingsSchema.safeParse({ timeoutMs: 0 }).success, false);
  const rule = { source: { provider: 'p', model: 'a' }, writer: { provider: 'p', model: 'b' } };
  assert.equal(SettingsSchema.safeParse({ rules: [rule, rule] }).success, false);
});
test('capacity, FIFO scheduling, queued cancellation and failure release', async () => {
  const queue = new RewriteQueue(2);
  let active = 0, high = 0;
  const order: number[] = [];
  const tasks = Array.from({ length: 6 }, (_, i) => queue.run(new AbortController().signal, async () => {
    active++; high = Math.max(high, active); order.push(i); await delay(5); active--; return i;
  }));
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
  assert.equal(high, 2); assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
  const single = new RewriteQueue(1), abort = new AbortController();
  const first = single.run(new AbortController().signal, () => delay(15));
  const pending = single.run(abort.signal, async () => assert.fail('cancelled queued work ran'));
  abort.abort(new Error('cancel'));
  await assert.rejects(pending, /cancel/); await first;
  await assert.rejects(single.run(new AbortController().signal, async () => { throw new Error('fail'); }));
  assert.equal(await single.run(new AbortController().signal, async () => 'released'), 'released');
});
