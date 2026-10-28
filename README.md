# DSH 模型嘴替插件

指定模型 A 完成工作，模型 B 只整理 A 面向用户的文字。B 不执行工具、不接管任务；其他模型 C 直接显示。

已实现原生 Host + Web Client bundle **0.1.2**，验证目标为 **DeepSeek Harness 0.2.1-rc.3**，不承诺兼容其他版本。安装包：`dist/dsh-plugins-model-spokesperson-0.1.2.tgz`。

GitHub 私有仓库：[bayuefeiyu/model-spokesperson](https://github.com/bayuefeiyu/model-spokesperson)。已构建安装包和 SHA-256 校验文件通过 [GitHub Releases](https://github.com/bayuefeiyu/model-spokesperson/releases) 提供；源码仓库不包含开发依赖和测试会话数据。

## 使用行为

- 仅匹配配置的精确 provider + model；正常结束的报告、分析、讨论和普通提问交给 B。
- 同次包含工具调用时直接显示；工具执行后下一步的独立报告仍可整理。异常、取消、截断、空文本、纯 JSON 和纯代码不改写。
- 整理期间隐藏正文，显示“正在整理表达…”。通过校验后在原助手行显示 B；失败显示 A 原文，不重跑 A 或工具。
- 保留 A 原始消息、思考、工具记录、usage 和 replayState。B 的展示稿与 usage 单独保存，提供“查看 A 的原文”和“复制整理稿”。宿主原有复制、轨迹、导出仍以 A 原始记录为准。
- 下次用户输入时，通过正式日志入口向 A 附带此前展示稿。B 完成不会自动生成额外回答。
- 刷新、重启、重载按保存记录恢复，不重新请求历史 B；没有展示稿的历史消息保持原文。

## 安装和配置

默认关闭，不附带账号、密钥或 A/B 路由。先在 DSH 配置可用 provider 和模型。B 每次整理会增加调用费用和等待时间；默认超时 45 秒，最多同时整理 2 次。

使用目标 DSH 安装自带的 CLI 安装到指定 profile（`dsh` 代表该 CLI；本机 shell 使用 RTK）：

在 DSH 插件管理器中选择“添加插件”，输入仓库 URL `https://github.com/bayuefeiyu/model-spokesperson`，或固定版本 `https://github.com/bayuefeiyu/model-spokesperson#v0.1.2`。私有仓库需要安装环境已登录有权限的 GitHub 账号。仓库根目录已声明组合包并包含预构建入口，无须安装时运行构建脚本。

```powershell
rtk proxy dsh plugin --profile YOUR_PROFILE add https://github.com/bayuefeiyu/model-spokesperson#v0.1.2
# 也可下载 Release 安装包后使用本地路径：
rtk proxy dsh plugin --profile YOUR_PROFILE add G:/ai/harness/dsh-plugins/model-spokesperson/dist/dsh-plugins-model-spokesperson-0.1.2.tgz
```

如果之前通过仓库 URL 安装成了普通依赖 `model-spokesperson-development`，先在同一 profile 移除它，再安装上述新版本；不要只对旧依赖重启或刷新。0.1.0 的独立 tarball 不受根清单缺失影响。

从 0.1.2 起可直接在前端设置：

1. 打开 **插件 → @dsh-plugins/model-spokesperson**。
2. 在“模型与表达”点击 **添加模型映射**，从 DSH 已配置的模型中选择 A（完成工作）和 B（整理表达）。
3. 勾选 **开启文字整理**，按需修改表达偏好或高级设置，然后点击 **保存设置**。
4. 在聊天输入框选择 A 并开始对话。此处映射不会自动切换会话模型。

界面支持多组映射；同一 provider/model 的 A 只能出现一次。只有保存才写入当前 profile；刷新和重启保留设置，修改对后续回复生效，进行中的整理保留原设置。部分模型暂时不可用时保留已有选择；并发修改会提示冲突，不会直接覆盖。

旧版本请通过插件管理器更新，或卸载后重装 0.1.2；卸载保留 profile 配置。也可以手动在该 profile 的 `cordis.patch.yml` 加入或合并：

```yaml
- id: model-spokesperson-host
  config:
    enabled: true
    rules:
      - source: { provider: YOUR_A_PROVIDER, model: YOUR_A_MODEL }
        writer: { provider: YOUR_B_PROVIDER, model: YOUR_B_MODEL }
    style: '中文，结论先行，少术语，忠实于原文。'
    timeoutMs: 45000
    maxConcurrentRewrites: 2
    maxInputChars: 30000
    maxOutputTokens: 8192
```

可添加多个 source；每个 source 只能一条规则，B 可与 A 同路由。超过输入预算直接回退，不截断原报告。`maxInputChars` 包括指令、用户问题和正文。不在此填写密钥。

`enabled: false` 停止后续整理，历史稿仍可读。完全停用并显示全部原文时，在 profile 中将 `model-spokesperson-host` 和 `model-spokesperson-ui` 都设为 `disabled: true`，或卸载 bundle：

```powershell
rtk proxy dsh plugin --profile YOUR_PROFILE remove @dsh-plugins/model-spokesperson
```

卸载保留会话原文及可忽略的插件记录。重装可恢复历史稿。升级本地 tarball 时使用新文件名或正式版本号，避免 pnpm 复用旧缓存。

## 开发和验证

需要 Node 24 和 npm，依赖固定在锁文件中。项目不使用 npm workspaces，避免同名链接遮蔽隔离安装包。

```powershell
rtk proxy npm ci --ignore-scripts
rtk proxy npm run check
rtk proxy npm test
rtk proxy npm run build
rtk proxy npm run pack:plugin
```

已有真实 AgentLoop 的 mock 测试、React/SlotCore 测试和隔离 Web 浏览器验收。具体范围见 [验收记录](evidence/validation.md)、[开发步骤](docs/DEVELOPMENT.md)、[交接](HANDOFF.md)。未调用真实收费模型，真实 A/B 的表达质量和延迟仍需配置路由后验收。

0.1.1 修复 GitHub URL 安装不识别组合包的问题；根清单与 tarball 共用同一布局，预构建文件随 Git 提交。新增分发回归测试，类型检查与 20 项测试通过。修复与 URL 安装验收见 [分发修复记录](evidence/distribution-fix.md)。

0.1.2 增加原生插件详情设置界面，配置通过宿主 ConfigForm 和 volatile Config 引用保存并生效。类型检查和 26 项测试通过；浏览器验证未保存不落盘、保存后下一条回复使用新配置、界面关闭 B、刷新及进程重启后保留配置。关闭后仍同步此前展示稿，保持历史讨论可理解。见 [设置界面验收](evidence/settings-validation.md)。

校验保护代码、路径、链接、数字、选项和部分状态用语，不能证明任意自然语言完全等义，因此保留原文入口。当前支持主聊天 Web，不改写子 agent、标题、压缩摘要、CLI/SDK 或导出。第三方替换聊天 renderer 或带嵌套子槽的自定义思考/图片 renderer 需单独适配。

[需求](docs/REQUIREMENTS.md) · [设计](docs/DESIGN.md) · [决策](docs/DECISIONS.md) · [任务](docs/TASKS.md) · [验收矩阵](docs/TEST-PLAN.md) · [运行时证据](evidence/runtime-inspection.json)

日常安装 `G:\ai\harness\dsh desktop` 仅作只读参考。本次未向日常桌面 profile 安装插件，未修改其配置或安装包。
