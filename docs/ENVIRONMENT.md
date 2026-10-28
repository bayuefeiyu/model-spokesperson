# 环境与接口证据

日期：2026-10-27。[只读 ASAR 报告](../evidence/runtime-inspection.json) 与本文件共同记录环境。

- 项目：G:\ai\harness\dsh-plugins\model-spokesperson。
- 日常安装：G:\ai\harness\dsh desktop，仅只读检查。已通过进程路径确认运行中的 DeepSeek Harness.exe 来自此目录。
- 实际版本：@deepseek-ai/dsh-desktop 和 DSH **0.2.1-rc.3**，build commit **be72761ee1a6736ebcdf4f3739363b083ae53c98**，dirty=false。
- 旧文档的 0.2.0-rc.2 已被本次重新检查结果替代。旧源码 G:\ai\harness\dsh 已移除，不依赖它。
- Node 24.20.0；Cordis 4.0.5、Schemastery 3.18.5、Zod 4.4.3。SDK 测试依赖固定为 rc.3，隔离集成使用安装 ASAR 内真实模块。
- 官方仓库 https://github.com/deepseek-ai/deepseek-harness 仅作公开参考，克隆未成功；实现依据实际安装包和同版本 SDK 声明，不声称已检出源码 commit。

关键包接口：dsh-agent 的 assistant-stream / pre-step / request / inbox / lifecycle，dsh-session 的 requestHeader / appendPluginRecord / deriveMessages，dsh-session-projection 的注册与 wire，dsh-client-ui-slots 的公开 entries/register/subscribe，官方 UI chat 默认助手及思考/图片 renderer。源码阅读位置均在提取的 .dev/runtime/node_modules/@deepseek-ai 对应包 lib/ 与 README。

ASAR 检查脚本本身不确认进程、兼容性和功能；运行中的进程确认、AgentLoop 测试与浏览器验收另行执行，见 evidence/validation.md。插件记录为实验 API，不能把本次成功推断为其他 DSH 版本兼容。

所有验收数据位于项目 .dev/runtime/spokesperson-home、.dev/workspace、.dev/documents；端口 31947。开发 home 置于 runtime 下保证共享模块身份。提取运行时跳过大文件/链接，不用于测试完整桌面、Office 或其他本机能力。
