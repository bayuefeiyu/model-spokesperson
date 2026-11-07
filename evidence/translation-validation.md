# 0.3.0 按项目英文底稿与单次翻译

日期：2026-11-07。目标 DSH 0.2.1-rc.3。基线为本地 0.2.4 工作区，新增实现后版本升为 0.3.0。

## 实现

- 设置在现有 native Config 中新增 `translationWorkspaces`（DSH workspace id）、`translationTarget`、`translationPrompt`；设置页通过 Client `workspaces` 投影列出项目，未列出的项目继续独立起草 + 核对。
- `system-prompt/assemble` 的全局 prepend 监听器在 `next()` 后读取最终 provider/model，按项目开关和精确 A 映射追加 `model-spokesperson:english-reply` section；保留其他 sections/tools/contexts/variables。
- `agent/request` 记录最终路由；翻译 attempt 不调用 `deriveMessages()` 或 `captureWorkContext()`，不保存 `context`；B 请求只有翻译提示词、目标语言、表达偏好和 A 正文，`tools: []`，一次调用。
- 记录使用 `policyVersion/promptVersion: 3`、`kind: 'translate'` 阶段、目标语言和独立 usage；失败、超限、取消回退 A，手动重试只额外调用一次 B。
- 完整提示预设覆盖追加 section 时，按实际 `system/message` 中缺失的规则标记记录 `translation-rule-missing` 并跳过 B；晚期路由变化记录 `translation-route-changed`。

## 实际检查

- `rtk proxy npm run check`：Host/Client 类型检查通过。
- `rtk proxy npm test`：**69/69 通过**。新增覆盖：项目开关隔离、A 规则注入、B 只收 A 正文、工具直通、完整提示预设、晚期路由、翻译重试使用当前设置、翻译预算、完整/不完整 v3 恢复、超长历史无哨兵、设置页项目选择与旧字段隐藏。
- `rtk proxy npm run build`：Host ESM + Client module-loader 构建通过。
- `rtk proxy npm run pack:plugin`：生成 `dist/dsh-plugins-model-spokesperson-0.3.0.tgz`，101,291 字节。
- SHA-256：`16878b17131a130d37981ff7bb7491878e9d338d5dd338e358ec682921d3a9c5`；已写入 `dist/SHA256SUMS.txt`。

## 边界

- 没有调用真实收费 A/B 模型；真实英文遵循率、译文质量、目标语言正确性、延迟和 token 费用未验收。
- 没有在隔离 Web profile 实际点击项目选择器并跑真实翻译；设置页和聊天行由 React/ConfigForm 测试覆盖，浏览器流程待补。
- 完整提示预设与晚期路由的“跳过翻译”只能防止误译，不能撤回已注入的英文规则；A 可能仍输出英文，此时显示 A 原文。
- 翻译输入只有 A 正文，但 A 自身仍携带项目工作上下文；工具结果、文件内容不会发送给 B。
