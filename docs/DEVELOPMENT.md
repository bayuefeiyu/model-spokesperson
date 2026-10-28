# 开发和隔离验证

目标 Node 24 / DSH 0.2.1-rc.3，Windows PowerShell。遵循本机 RTK 指令。

## 构建

```powershell
rtk proxy npm ci --ignore-scripts
rtk proxy npm run check
rtk proxy npm test
rtk proxy npm run build
rtk proxy npm run pack:plugin
```

Host/Client 分别检查类型，避免两端 Context.sessions 合并。测试使用官方 AgentLoop testkit、真实 Cordis、React 和 SlotCore。根 package.json/cordis.patch.yml 是分发入口，GitHub 和 tarball 共用布局。构建后的 lib/index.js、packages/host/lib、packages/ui/lib 必须随 Git 提交，因为仓库 URL 安装不依赖执行生命周期构建。不要启用 npm workspaces，避免遮蔽隔离安装包。

## 准备独立运行时

先核对安装版本与运行时证据。此机器可使用安装内 Python（也可换可用 Python 3）：

```powershell
rtk proxy "G:\ai\harness\dsh desktop\resources\runtime\primary-runtime\dependencies\python\python.exe" scripts/inspect-runtime.py --installation "G:\ai\harness\dsh desktop" --output evidence/runtime-inspection.json
rtk proxy "G:\ai\harness\dsh desktop\resources\runtime\primary-runtime\dependencies\python\python.exe" scripts/prepare-runtime.py
rtk proxy node scripts/dev-cli.mjs --profile spokesperson-dev --from-default-profile web --dump-config
rtk proxy node scripts/dev-cli.mjs plugin --profile spokesperson-dev add G:/ai/harness/dsh-plugins/model-spokesperson/dist/dsh-plugins-model-spokesperson-0.2.2.tgz
rtk proxy node scripts/prepare-demo.mjs
rtk proxy node scripts/dev-cli.mjs --profile spokesperson-dev --port 31947 --no-open
```

提取脚本只读复制 ASAR 的 dsh 子树，跳过链接及大于 20 MiB 的文件；足够 Web/mock 验收，不能代表完整桌面或 Office 功能。迁移机器时需调整脚本内安装路径。

| 对象 | 项目内位置 |
|---|---|
| DSH_HOME | `.dev/runtime/spokesperson-home` |
| profile | 该 home 下 `profiles/spokesperson-dev` |
| 启动目录及 mock 请求日志 | `.dev/workspace` |
| 默认 Documents 替代根 | `.dev/documents` |
| Web 端口 | `31947` |

dev-cli 仅对子进程设置 home，不改全局环境。home 放在 runtime 下确保 DSH 模块单实例。单独设置 cwd 不改变 Web 默认工作区，因此 prepare-demo 显式设置 workspace-controller.documentsDirectory。试验初期发现默认路径行为后已换用新 home；此前无模型工具执行。旧 .dev/dsh-home* 为调试遗留，不作为验收环境。

mock 有 a/b/c，默认 a→b，关闭标题模型和会话遥测，不复制用户账号。A 含思考块；B 等约一秒，问题含 fail 时失败。请求内容只在忽略的 .dev/workspace/calls.jsonl，不提交真实用户数据。

## 浏览器

服务打印本次带 token 的本地 URL，将其作为参数，不提交 token：

```powershell
rtk proxy node scripts/browser-e2e.mjs LOCAL_URL
```

使用已安装 Microsoft Edge 无头模式。验证 pending 无原文闪现、原行 B、思考折叠、原文入口及刷新不增加请求，输出 evidence/browser-e2e.json 和 mock-chat.png。调试输出在忽略的 evidence/private。需要 Playwright npm 包。

`browser-fallback.mjs LOCAL_URL` 验证 B 失败后原文回退且没有重做 A；`browser-history.mjs LOCAL_URL ready|disabled|uninstalled` 读取最近的同名测试会话，验证重启、禁用或卸载后的历史读取不增加调用。先运行 e2e 生成历史测试定位数据。不要并行提交这些浏览器脚本，以免干扰调用计数。

重装同版本 tarball 时用新文件名以避免 pnpm 缓存；正式升级递增版本。检查安装/禁用/重启/卸载仅在隔离 profile 完成。真实账号接入后做小批量质量、延迟和费用验收；本次未操作日常桌面 profile、用户 .dsh 或安装包。

## 前端设置回归

0.1.2 使用原生 Settings 服务与 `plugins.bundle.config`。`src/config.ts` 的字段为 volatile 引用；Host 在 source attempt 开始读取设置，B 保留该次快照。不要只在插件 apply 时取值，否则界面保存后运行逻辑仍会使用旧设置。

可用 `node scripts/prepare-demo.mjs spokesperson-report --empty-settings` 创建关闭且无映射的 mock 配置，再启动该 profile。`node scripts/browser-settings.mjs LOCAL_URL spokesperson-report` 从前端配置 A/B、核对 2 轮、输出 100000 tokens，保存后验证实际调用序列 A/B/B/B 和第一步成稿隔离，关闭 B 并恢复；重启服务后加 `--verify-only` 验证持久化。脚本都通过 rtk proxy 执行，结果在 evidence/report-settings.json、report-settings-restart.json 和 report-settings.png。

0.2.0 使用独立 profile `spokesperson-report`、端口 31950。`browser-e2e.mjs` 输出 report-chat.json/png，检查起草/核对进度、无原文闪现与刷新；`browser-fallback.mjs` 使用 review-fail 让独立初稿成功但核对失败，检查 A 原文回退且只调用 A/B/B。mock 不验证模型是否真实遵循写作和核对指令，语义质量需另行验证。

0.2.1 在同一隔离 profile 升级，使用 `rtk proxy node scripts/browser-prompts.mjs LOCAL_URL spokesperson-report` 验证未配置提示词时的默认全文、多行编辑、原生保存、下一次 B 请求精确使用自定义 system、逐项恢复默认及刷新。该脚本最终保留自定义 mock 提示词供重启检查；进程重启/重新安装后加 `--verify-only` 验证保留。结果为 evidence/prompt-settings.json、prompt-restart.json 和 prompt-settings.png，截图只截提示词区域。

0.2.2 可用 `prepare-demo.mjs spokesperson-report --mock-only` 更新隔离 mock 而保留 profile 设置。`browser-retry.mjs LOCAL_URL` 验证起草/核对一次性失败后的按钮、仅调用 B、成功阶段复用及刷新，并保存一个失败会话给重启检查。重启/重新安装后加 `--resume-only` 检查冷历史重试。mock 通过项目内 calls.jsonl 判断指定问题的首次失败，进程重启不重置该事实。结果为 retry-browser.json、retry-restart.json 和 retry-button.png。

rc.3 Client 模块表不公开 dsh-typert-protocol/remote-info；build 显式打包这个没有运行时导入的纯叶模块，SDK 服务、Cordis、React、Zod 继续 external，并携带 THIRD_PARTY_NOTICES.txt。Client 使用 remote.modelSpokesperson 时必须同时注入 remote 和该 namespace；只注入子 namespace 不能读取父服务。
