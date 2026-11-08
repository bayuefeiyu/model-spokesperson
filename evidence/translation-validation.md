# 0.3.0 / 0.3.1 / 0.3.2 按项目英文底稿与单次翻译

日期：2026-11-07。0.3.0 在 DSH 0.2.1-rc.3 实现；0.3.1 在 DSH 0.2.2-rc.1 重新验证，迁移细节见 [0.2.2 适配记录](dsh-0.2.2-compat.md)。基线为本地 0.2.4 工作区。

## 实现

- 设置在现有 native Config 中新增 `translationWorkspaces`（DSH workspace id）、`translationTarget`、`translationPrompt`；设置页通过 Client `workspaces` 投影列出项目，未列出的项目继续独立起草 + 核对。
- `system-prompt/assemble` 的全局 prepend 监听器在 `next()` 后读取最终 provider/model，按项目开关和精确 A 映射追加 `model-spokesperson:english-reply` section；section 正文来自可编辑的 `englishPrompt`。保留其他 sections/tools/contexts/variables。
- `agent/request` 记录最终路由；翻译 attempt 不调用 `deriveMessages()` 或 `captureWorkContext()`，不保存 `context`；B 请求只有翻译提示词、目标语言和 A 正文，`tools: []`，一次调用；翻译方式不再读取或附加旧 `style`。
- 记录使用 `policyVersion/promptVersion: 3`、`kind: 'translate'` 阶段、目标语言和独立 usage；失败、超限、取消回退 A，手动重试只额外调用一次 B。
- 完整提示预设覆盖追加 section 时，按实际 `system/message` 中缺失的规则标记记录 `translation-rule-missing` 并跳过 B；晚期路由变化记录 `translation-route-changed`。

## 0.3.2 A 中文回复诊断

在真实会话 `session-28109d2d-c15b-4417-abc6-421426b24d2a`（项目 H3）中检查：

- A 的实际 `system/message` 包含 `model-spokesperson:english-reply` 标记，说明规则已注入；
- A 的 reasoning 写的是 “Respond concisely in Chinese”，可见正文也是中文；
- 用户原消息是中文，原规则中“按交付物请求语言”被 A 理解成聊天回复也应用中文。

结论：不是注入缺失，而是模型指令遵循问题。0.3.2 默认规则改为明确覆盖用户中文输入（聊天回复必须英文，文件/文档/UI 文案保留请求语言），并把整段规则开放为 `englishPrompt` 设置。翻译方式不再读取或附加旧 `style`；所有文风和翻译要求写入 `translationPrompt`。

## 实际检查

- `rtk proxy npm run check`：Host/Client 类型检查通过。
- `rtk proxy npm test`：0.3.0 在 DSH 0.2.1-rc.3 上 69/69；0.3.1 在 0.2.2-rc.1 上 **70/70**。新增覆盖：项目开关隔离、A 规则注入、自定义 `englishPrompt` 替换默认规则、翻译请求不附加旧 `style`、B 只收 A 正文、工具直通、完整提示预设、`agent.model.select()` 切 C 不翻译/切回 A 再翻译、翻译重试使用当前设置、翻译预算、完整/不完整 v3 恢复、超长历史无哨兵、设置页项目选择与旧字段隐藏。
- `rtk proxy npm run build`：Host ESM + Client module-loader 构建通过。
- `rtk proxy npm run pack:plugin`：0.3.0 生成 `dist/dsh-plugins-model-spokesperson-0.3.0.tgz`（101,291 字节，SHA-256 `16878b17131a130d37981ff7bb7491878e9d338d5dd338e358ec682921d3a9c5`）；0.3.1 生成 `dist/dsh-plugins-model-spokesperson-0.3.1.tgz`（101,479 字节，SHA-256 `643db1dd54152b02a9eb6e928c90ce65ae9bc5bf252f6900b4abdf98707c3401`）；0.3.2 生成 `dist/dsh-plugins-model-spokesperson-0.3.2.tgz`（103,585 字节，SHA-256 `792e29491d95df65fc1568993e7be5d1d5d3cc153fa4f996639267e9696234cd`）。均已写入 `dist/SHA256SUMS.txt`。
- 将 0.3.2 安装到隔离 profile `spokesperson-report`，`--dump-config` 退出码 0；启动端口 31952 后 `browser-smoke` 无 pageerror/console error。未实际点击项目选择或保存翻译设置。
- 创建 `v0.3.2` tag 和 [GitHub Release](https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v0.3.2)，上传 0.3.2 tarball 与 `SHA256SUMS.txt`；用 `fetchLatestRelease({ force: true })` 复核返回 `0.3.2`，资产名为 `dsh-plugins-model-spokesperson-0.3.2.tgz`。更新检查有五分钟缓存，已打开旧页面的用户需刷新或点击“已是最新”强制重查。

## 边界

- 没有调用真实收费 A/B 模型；真实英文遵循率、译文质量、目标语言正确性、延迟和 token 费用未验收。
- 没有在隔离 Web profile 实际点击项目选择器并跑真实翻译；设置页和聊天行由 React/ConfigForm 测试覆盖，浏览器流程待补。
- 完整提示预设的“跳过翻译”只能防止误译，不能撤回已注入的英文规则；A 可能仍输出英文，此时显示 A 原文。DSH 0.2.2 会在 step preparation 后拒绝 `agent/request` 改路由，要求先 `agent.model.select()`；插件保留路由复核仅用于兼容旧版/允许该改法的组合。
- 翻译输入只有 A 正文，但 A 自身仍携带项目工作上下文；工具结果、文件内容不会发送给 B。
