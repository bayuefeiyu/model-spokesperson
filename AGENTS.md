# 开发说明

## 项目定位

这是 DeepSeek Harness 原生插件项目，不是 Codex 插件、MCP 嘴替工具或 B 主导的多 agent 应用。先读 README.md、HANDOFF.md、docs/REQUIREMENTS.md、docs/DESIGN.md 和 docs/TASKS.md。

## 不可改变的要求

- A 负责思考、决策、工具调用、文件修改和任务执行；B 只改写面向用户的文字，不管理 A、不调用工作工具。
- 仅处理明确配置的 provider + model 组合；C 和其他未匹配模型原样通过。
- 重点是独立的报告、分析回复、讨论和普通文字提问。随工具调用出现的短进度提示可直接显示。
- 不得将未实现的接口、未经运行验证的设计写成已支持或已测试。
- 保留原文、事实与来源；不得把 B 的改写冒充 A 的原始 provider 输出或推理记录。

## 工作目录与隔离

- 本项目根目录：`G:\ai\harness\dsh-plugins\model-spokesperson`。
- 日常安装目录：`G:\ai\harness\dsh desktop`。不要修改、替换 app.asar 或安装目录内的运行文件。
- 旧源码目录 `G:\ai\harness\dsh` 已由用户移除，不再作为可用依赖或参考路径。需要源码时，在本项目 `.dev` 下获取与目标运行时匹配的官方源码，并遵循该源码自己的 AGENTS.md。
- 使用本项目内 `.dev/runtime/spokesperson-home`、专用 profile、独立端口和测试 workspace，并覆盖 Web 默认 Documents 目录。不得仅换 profile 就声称已经隔离用户数据。
- 不更改全局环境变量或日常 `.dsh` 配置。开发测试默认使用 mock 模型；真实 API 验证单独记录费用、模型与结果，不复制凭据到文档或版本库。
- 用户已要求完成开发，授权本地实现和隔离测试；日常桌面安装在用户要求接入时执行。

## 本机命令约定

在此用户的环境中遵循 `C:\Users\bayue\.codex\RTK.md`：shell 命令使用 `rtk` 前缀，不支持的命令用 `rtk proxy`。PowerShell cmdlet 需通过 PowerShell 进程运行；不要写 `rtk proxy Get-Content`。如项目迁移到其他机器，先确认当地工具与指令，避免假定 Windows 路径可用。

## 实现与验证

- 优先 TypeScript + ESM + Cordis 原生插件，依赖版本以确认的目标 DSH 为准；不得为了安装绕过 peer 兼容检查。
- 先完成 docs/TASKS.md 的接口与展示替换原型，再确定最终包装结构。不要一开始改 agent-loop。
- 模型输入必须通过目标版本支持的日志/上下文入口建立；不得偷偷修改冻结的 agent 请求。
- 并发状态按 session / turn / step / attempt / message 隔离；不得用全局布尔变量防递归。
- 注册、取消、热重载和卸载都应清理资源；输出改写失败不应重跑 A 的工作或工具。
- 依据 TEST-PLAN.md 做有意义的定向测试；不为文档或机械变化堆砌测试，也不默认运行 DSH 全量测试。
- 每阶段更新 TASKS.md；交接时写清实际执行过的命令、结果、限制与下一步。新增架构选择记录在 docs/DECISIONS.md。
