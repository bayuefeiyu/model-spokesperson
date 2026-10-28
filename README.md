# DSH 模型嘴替插件

指定模型 A 完成工作，模型 B 根据工作上下文独立作答，再参考 A 的报告核对自己的初稿。B 不执行工具、不接管任务；其他模型 C 直接显示。

当前原生 Host + Web Client bundle **0.2.0**，目标为 **DeepSeek Harness 0.2.1-rc.3**，不承诺兼容其他版本。安装包：`dist/dsh-plugins-model-spokesperson-0.2.0.tgz`。

GitHub 私有仓库：[bayuefeiyu/model-spokesperson](https://github.com/bayuefeiyu/model-spokesperson)。已构建安装包和 SHA-256 校验文件通过 [GitHub Releases](https://github.com/bayuefeiyu/model-spokesperson/releases) 提供；源码仓库不包含开发依赖和测试会话数据。

## 使用行为

- 仅匹配配置的精确 provider + model；正常结束的报告、分析、讨论和普通提问交给 B。
- 在 A 每次生成前捕获当时有效的工作上下文：用户要求、已记录的文件内容、工具调用与结果、此前公开工作记录。B 第一次调用看不到 A 本次报告，也不继承 A 的系统文风、隐藏推理或 provider replayState。
- B 独立起草后，才在核对调用中获得 A 的报告。核对指令要求以 B 自己的上一稿为底稿，保留自己的结构和表达，只查漏纠错；发生矛盾优先参考实际工作证据。默认一轮核对（B 共调用两次），可设 0 或多轮。
- 同次包含工具调用时直接显示；工具执行后下一步的独立报告仍可交给 B。异常、取消、截断、空文本、纯 JSON 和纯代码直通。
- 等待期间隐藏 A 正文和 B 未完成的初稿，显示起草/核对阶段。全部步骤完成后在原助手行显示 B；任一步失败显示 A 原文，不重跑 A 或工具。
- 保留 A 原始消息、思考、工具记录、usage 和 replayState。B 每一步请求、正文、usage 单独记录，并合计 B 的 token 用量。提供“查看 A 的原文”和“复制 B 回复”；宿主原有复制、轨迹、导出仍以 A 原始记录为准。
- 下次用户输入时，通过正式日志入口向 A 附带此前展示稿。B 完成不会自动生成额外回答。
- 刷新、重启、重载按保存记录恢复，不重新请求历史 B；没有展示稿的历史消息保持原文。

## 安装和配置

默认关闭，不附带账号、密钥或 A/B 路由。先在 DSH 配置可用 provider 和模型。每次回复默认增加两次 B 调用；核对轮数增加时，费用和等待也随之增加。默认最多同时处理 2 条回复。B 会读取更完整的工作材料，输入量通常高于旧版。

使用目标 DSH 安装自带的 CLI 安装到指定 profile（`dsh` 代表该 CLI；本机 shell 使用 RTK）：

在 DSH 插件管理器中选择“添加插件”，输入仓库 URL `https://github.com/bayuefeiyu/model-spokesperson`，或固定版本 `https://github.com/bayuefeiyu/model-spokesperson#v0.2.0`。私有仓库需要安装环境已登录有权限的 GitHub 账号。仓库根目录已声明组合包并包含预构建入口，无须安装时运行构建脚本。

```powershell
rtk proxy dsh plugin --profile YOUR_PROFILE add https://github.com/bayuefeiyu/model-spokesperson#v0.2.0
# 也可下载 Release 安装包后使用本地路径：
rtk proxy dsh plugin --profile YOUR_PROFILE add G:/ai/harness/dsh-plugins/model-spokesperson/dist/dsh-plugins-model-spokesperson-0.2.0.tgz
```

如果之前通过仓库 URL 安装成了普通依赖 `model-spokesperson-development`，先在同一 profile 移除它，再安装上述新版本；不要只对旧依赖重启或刷新。0.1.0 的独立 tarball 不受根清单缺失影响。

从 0.1.2 起可直接在前端设置：

1. 打开 **插件 → @dsh-plugins/model-spokesperson**。
2. 在“模型与表达”点击 **添加模型映射**，从 DSH 已配置的模型中选择 A（完成工作）和 B（独立作答）。
3. 勾选 **开启 B 回复**，按需修改表达偏好、核对轮数或高级设置，然后点击 **保存设置**。
4. 在聊天输入框选择 A 并开始对话。此处映射不会自动切换会话模型。

界面支持多组映射；同一 provider/model 的 A 只能出现一次。只有保存才写入当前 profile；刷新和重启保留设置，修改对后续回复生效，进行中的整理保留原设置。部分模型暂时不可用时保留已有选择；并发修改会提示冲突，不会直接覆盖。

通过 GitHub URL 安装的旧版本，在同一 profile 的插件管理器卸载后重装 0.2.0；卸载保留 profile 配置。上游 registry/npm 更新入口不适用于 Git URL 来源。也可以手动在该 profile 的 `cordis.patch.yml` 加入或合并：

```yaml
- id: model-spokesperson-host
  config:
    enabled: true
    rules:
      - source: { provider: YOUR_A_PROVIDER, model: YOUR_A_MODEL }
        writer: { provider: YOUR_B_PROVIDER, model: YOUR_B_MODEL }
    style: '中文，结论先行，少术语，清楚自然，事实准确。'
    reviewRounds: 1
    timeoutMs: 0
    maxConcurrentRewrites: 2
    maxInputChars: 0
    maxOutputTokens: 0
```

可添加多个 source；每个 source 只能一条规则，B 可与 A 同路由。不在此填写密钥。

- `reviewRounds: 1` 表示独立起草 + 一轮核对；设为 0 时只起草，始终不向 B 提供 A 本次报告。多轮核对都基于 B 上一稿继续完善。
- `maxInputChars: 0` 表示插件不额外限制字符数；正数是每次 B 请求的指令和 JSON 材料总字符上限。核对输入还包含 B 上一稿及 A 报告。超过用户设置的预算直接回退，不截断材料。
- `maxOutputTokens: 0` 表示不覆盖 B 提供方/模型的默认输出预算；正数按用户设置传入，不再限制为 32768。实际能力仍受模型和端点限制，插件不保证任意模型有 1M 上下文。
- `timeoutMs: 0` 表示插件不额外设置超时；正数是排队、起草及全部核对的总时间。不再有隐含的“输入字符数 × 4”输出上限。
- 升级保留已有显式设置，包括旧版写入的 30000 字符、8192 tokens、45 秒等。需要放宽时在设置中改为 0 或自行指定。

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

已有真实 AgentLoop 的 mock 测试、React/SlotCore 测试和隔离 Web 浏览器验收。当前流程见 [独立报告验收](evidence/report-validation.md)、[开发步骤](docs/DEVELOPMENT.md)、[交接](HANDOFF.md)。未调用真实收费模型，真实 B 的独立写作质量、核对效果和延迟仍需配置路由后验收。

0.1.1 修复 GitHub URL 安装不识别组合包的问题；根清单与 tarball 共用同一布局，预构建文件随 Git 提交。新增分发回归测试，类型检查与 20 项测试通过。修复与 URL 安装验收见 [分发修复记录](evidence/distribution-fix.md)。

0.1.2 增加原生插件详情设置界面，配置通过宿主 ConfigForm 和 volatile Config 引用保存并生效。类型检查和 26 项测试通过；浏览器验证未保存不落盘、保存后下一条回复使用新配置、界面关闭 B、刷新及进程重启后保留配置。关闭后仍同步此前展示稿，保持历史讨论可理解。见 [设置界面验收](evidence/settings-validation.md)。

0.2.0 将成稿润色改为“独立起草 → 参考 A 报告核对自己的稿件”，设置支持核对轮数及用户控制预算。旧版历史展示稿继续回放，不补跑新流程。新稿允许重排信息，不再按 A 成稿的数字/代码出现次数和顺序作机械等同校验；事实核对依靠模型指令与证据，不能证明内容必然正确。

工作上下文来自当时有效的会话消息；若宿主已压缩历史，只能提供保留下来的材料。A 本次调用中新产生且未写入先前记录的结论，第一步 B 无法获知，第二步只能把 A 报告作为参考核查。附件本身不直接读取，B 只获得不可见标记和 A 已实际读取的记录。

当前支持主聊天 Web，不处理子 agent、标题、压缩摘要、CLI/SDK 或导出。第三方替换聊天 renderer 或带嵌套子槽的自定义思考/图片 renderer 需单独适配。

[需求](docs/REQUIREMENTS.md) · [设计](docs/DESIGN.md) · [决策](docs/DECISIONS.md) · [任务](docs/TASKS.md) · [验收矩阵](docs/TEST-PLAN.md) · [运行时证据](evidence/runtime-inspection.json)

日常安装 `G:\ai\harness\dsh desktop` 仅作只读参考。本次未向日常桌面 profile 安装插件，未修改其配置或安装包。
