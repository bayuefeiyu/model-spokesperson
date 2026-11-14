# Model Spokesperson · 模型嘴替

DSH 原生 Host + Client 插件。当前版本 **0.3.5**，适配 **DSH 0.2.2-rc.3**。

A 完成分析、决策、工具调用和文件修改，并用英文写面向用户的聊天回复。B 只收到 A 的这条回复，按目标语言和自定义文风翻译一次。文件、文档和界面仍使用任务要求的语言。仅处理明确配置的 provider + model，其他模型直接回复。

## 使用方式

1. 在 DSH 配置可用 provider 和模型；插件默认关闭，不附带账号或密钥。
2. 打开 **插件 → @dsh-plugins/model-spokesperson**，添加 A（完成工作）→ B（翻译回复）映射，勾选 **开启 B 回复**。
3. 在 **项目启用范围** 选择项目，勾选 **在本项目启用嘴替**，编辑英文回复要求、目标语言和翻译提示词，点击 **保存设置**。
4. 聊天输入框选择 A。插件不会自动切换会话模型。

**项目关闭或未启用时，由 A 直接回复，不注入英文要求、不调用 B。** 0.3.5 已移除旧表达偏好、独立起草、核对提示词和核对轮数的设置入口；新回复不会恢复旧流程。翻译设置始终可编辑。旧配置值和旧会话保留，旧失败记录仍可按原协议手动恢复。

B 不接收对话历史、工具结果或文件材料，不使用工具，也不做二次核对。同一步含工具调用的进度文字直接显示；只有正常结束的独立文字回复进入翻译，纯代码或 JSON 交付物直接显示。每条翻译增加一次 B 调用。

英文规则由插件按项目和模型动态注入，不修改项目 AGENTS.md。完整系统提示预设可能覆盖规则，此时跳过 B；切换到未匹配模型同样直接显示。A 是否遵循英文要求仍受模型本身影响。

## 安装与更新

DSH 插件管理器添加仓库地址 [model-spokesperson](https://github.com/bayuefeiyu/model-spokesperson)。默认分支包含预构建入口，历史 tag 保持各自的宿主版本限制。升级后刷新页面或重启 DSH，以加载新 Client。

```powershell
rtk proxy dsh plugin --profile YOUR_PROFILE add https://github.com/bayuefeiyu/model-spokesperson
# 或安装本地打包产物：
rtk proxy dsh plugin --profile YOUR_PROFILE add G:/ai/harness/dsh-plugins/model-spokesperson/dist/dsh-plugins-model-spokesperson-0.3.5.tgz
```

插件详情的更新按钮检查 GitHub Release 的 tarball 资产；仅推送源码不会产生 Release。Git URL 安装来源可重新安装默认分支，或使用上述本地包。卸载插件保留配置和会话记录。

## 翻译、失败与历史

- B 的 system 为翻译提示词和目标语言，user 只包含当前 A 正文；文风直接写入翻译提示词。
- 等待时显示“B 正在翻译…”，完成后原行显示译文，可查看 A 原文、复制 B 回复。刷新回放已保存译文，不重复调用。
- 失败、超时、截断、空输出或超限时回退 A 原文。手动重试只调用 B，使用当前翻译设置，不重跑 A 或工具。
- 新输入、取消、卸载会停止挂起任务，迟到结果不会提交；多会话隔离并有队列并发限制。
- 已显示的 B 文字会在下一次用户提问时同步到 A 的上下文；A 原始消息、usage 和 replayState 保留，B 用量单独记录。

设置通过原生 ConfigForm 保存。未保存的修改不生效；并发修改会提示冲突。保存只影响后续回复，进行中的翻译保留开始时的设置。

高级设置支持超时、并发、输入字符和输出 token 预算。超时和输入上限为 0 表示插件不额外限制；输出为 0 表示跟随 B 模型配置。实际仍受提供方限制。超出自设输入预算会回退，不截断；提高预算保存后可重试。升级保留用户已有显式限额。

手动配置示例（workspace id 建议由设置页选择）：

```yaml
- id: model-spokesperson-host
  config:
    enabled: true
    rules:
      - source: { provider: YOUR_A_PROVIDER, model: YOUR_A_MODEL }
        writer: { provider: YOUR_B_PROVIDER, model: YOUR_B_MODEL }
    translationWorkspaces: [YOUR_WORKSPACE_ID]
    translationTarget: '中文'
    timeoutMs: 0
    maxConcurrentRewrites: 2
    maxInputChars: 0
    maxOutputTokens: 0
```

省略 englishPrompt、translationPrompt 时使用内置默认值，可在设置页编辑并逐项恢复默认。

## 开发和验证

需要 Node 24 和 npm，依赖固定在锁文件中。项目不使用 npm workspaces，避免同名链接遮蔽隔离安装包。

```powershell
rtk proxy npm ci --ignore-scripts
rtk proxy npm run check
rtk proxy npm test
rtk proxy npm run build
rtk proxy npm run pack:plugin
```


已有真实 AgentLoop mock、原生设置组件和隔离 Web 验收。开发不改日常 desktop 安装包或配置，也不调用收费 API。真实模型的英文遵循率、译文质量和费用仍需抽样。

当前支持主聊天 Web，不处理子 agent、标题、压缩摘要、CLI/SDK 或导出。第三方聊天 renderer 需单独适配。

[需求](docs/REQUIREMENTS.md) · [设计](docs/DESIGN.md) · [决策](docs/DECISIONS.md) · [任务](docs/TASKS.md) · [交接](HANDOFF.md)
