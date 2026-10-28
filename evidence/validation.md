# 验收记录

开发开始：2026-10-27。最终复核：2026-10-28。插件 **0.1.0**，DSH **0.2.1-rc.3**，build **be72761ee1a6736ebcdf4f3739363b083ae53c98**，Node **24.20.0**。

最终包、源文件摘要和机器可读结果见 [validation.json](validation.json)。安装包为 `dist/dsh-plugins-model-spokesperson-0.1.0.tgz`，校验值在 `dist/SHA256SUMS.txt`。实际安装的 Host/Client 文件与本次构建逐字节摘要一致。

## 实际执行结果

| 检查 | 命令（均经 rtk proxy） | 结果 |
|---|---|---|
| Host/Client 类型检查 | npm run check | 通过 |
| 自动测试 | npm test | 19 通过、0 失败 |
| 构建 | npm run build | Host ESM + Client module-loader 通过 |
| 打包 | npm run pack:plugin | 包内包含完整 Host/UI 子包，通过 |
| 安装、替换、卸载、重装 | node scripts/dev-cli.mjs plugin --profile spokesperson-dev add/remove … | 隔离 profile 通过，无兼容检查绕过 |
| 原生 Web 启动 | node scripts/dev-cli.mjs --profile spokesperson-dev --port 31947 --no-open | 无插件激活失败 |
| 页面正常流程 | node scripts/browser-e2e.mjs LOCAL_URL | 无原文闪现、同一行 B、思考折叠、原文入口、刷新不请求，通过 |
| 页面失败流程 | node scripts/browser-fallback.mjs LOCAL_URL | B 失败显示 A，一次 A + 一次 B，不重跑工作，通过 |
| 进程重启及重装后回放 | node scripts/browser-history.mjs LOCAL_URL ready | 保存稿恢复，无新增调用，通过 |
| Host/UI 同时禁用 | 同脚本 disabled，启动加 --patch .dev/disabled.yml | 原文可读，无新增调用，通过 |
| 卸载后读取 | 同脚本 uninstalled | 忽略插件记录并显示原文，无新增调用，通过 |

浏览器使用无头 Microsoft Edge。以上页面检查均无 pageerror / console error。启动出现继承环境的 SOCKS 代理不受支持提示，与本地 mock 无关。最终验收后已停止测试 Web 服务。

## 19 项自动测试覆盖

- A 原始正文、冻结请求、provider replayState 保留；B 无工具、usage 分开；下次输入只同步一次，不自动唤醒 A。
- 精确 provider/model，C 直通，A→C→A，同名不同 provider，标题辅助调用、子 agent 和同路由 B 不递归。
- 短问题、纯 JSON/代码、source 截断/取消/空文本，失败 attempt 后的真实重试。
- 工具前后文本/思考/工具块交错，参数、执行次数及结果与禁用基线一致；工具后的独立报告可整理；B 输入不含隐藏思考和工具结果。
- B 网络异常/空输出/截断/工具/关键片段变化回退；超时和不合作 provider 的迟到结果丢弃；新输入与卸载取消。
- 两个真实 AgentLoop session 并行，独立结果与共享并发限制；队列 FIFO、排队取消、异常后释放。
- 正式 SessionStore 分叉继承展示稿且不新增调用；旧/过期/已变更消息、工具、interrupted 的展示保护。
- React 原文对象不变、live→durable 交接不闪原文；真实 SlotCore 下压缩 registrant、延迟声明、思考/图片叶子委托及卸载恢复。
- 配置校验，以及代码、链接、数字（含中文紧邻金额）、编号、问题及否定/未验证状态保护。

## 环境边界

验收使用从指定安装 ASAR 只读提取的 runtime，home 为 `.dev/runtime/spokesperson-home`，mock 请求日志在 `.dev/workspace`，Web 默认工作区限定在 `.dev/documents`。没有复制用户 provider 凭据。提取跳过链接和 >20 MiB 文件，不能据此宣称完整桌面/Office 验收。

开发初期发现仅设置 cwd 不能隔离 Web 默认 Documents 工作区后，已换用新 home 并显式配置覆盖；此前没有工具执行。早期 npm workspace 链接导致加载开发源码而混用 Session 类，已移除，并用最终 tarball 和包内相对入口重新完成验证。Client 的压缩 fiber 名、方法 receiver 和子槽授权问题均已修复，最终结果不依赖调试修改。

日常桌面安装、ASAR、profile、用户 .dsh 和全局环境未修改。未调用真实模型 API，无真实模型费用。

## 尚未验证

真实 A/B 的语义质量、延迟和成本需用户配置路由后抽样。Electron 桌面实际安装、真实附件、长历史分页、多客户端断线重连、删除/重生成完整浏览器矩阵、未来版本迁移尚未验收。当前有正式 projection、会话内插件记录、消息身份保护和分叉单测支撑相应机制，但不把它们等同于上述完整 UI 用例通过。

当前交付范围是 rc.3 原生 Host + 主聊天 Web Client。CLI/SDK/导出保持 A，B 由独立复制按钮提供；第三方含嵌套子槽的 renderer 需要单独适配。关键片段校验不等同于自然语言语义证明。
