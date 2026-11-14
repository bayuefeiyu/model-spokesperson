# DSH 0.2.2-rc.3 兼容适配

2026-11-14，插件版本 0.3.4。

## 原因与改动

用户安装 0.3.3 时，插件根清单的 engines.dsh 精确声明为 0.2.2-rc.1，安装器在 rc.3 正常阻止加载。本机安装包确认已是 0.2.2-rc.3，build commit 为 6b729fedde0c8fd03af7afdf5a711aa64fe87c3b。

- 根 bundle、Host、UI 的引擎与 DSH peer 依赖统一更新到 rc.3，开发 SDK 同步升级。
- rc.3 已移除 agents.roots()。主聊天识别改为检查持久 origin 排除 subagent，并用 get(id) 确认实例仍在 live registry。恢复历史时通过 list() 遍历并应用相同筛选。重试入口使用 get(sessionId)。现有子 agent、分叉、卸载和恢复测试继续通过。
- rc.3 的投影与 Remote 类型使用 Zod 4.6.6，插件及组件清单同步到相同版本。rc.1 锁定依赖迁移到忽略目录备份，rc.3 的锁文件重新生成且正常解析 peer 依赖。
- 分发回归检查要求所有组件的宿主版本声明与实际测试 SDK 版本相同。

## 验证

- `rtk proxy npm run check` 通过 Host 和 Client 类型检查。
- `rtk proxy npm test` 70/70 通过，包含主聊天、子 agent 排除、翻译、重试、历史、前端设置和分发清单。
- `rtk proxy npm run build`、`rtk proxy npm run pack:plugin` 成功。
- 从当前桌面安装包复制只读运行时到项目 .dev，版本核实为 rc.3。原生 `dsh plugin --profile spokesperson-rc3 add` 成功安装 0.3.4 tarball，正常执行兼容检查。
- 使用隔离 DSH_HOME、profile、Documents 替代目录和端口 31958 运行实际包。浏览器检查项目选择、原生保存、英文规则、B 仅收当前正文并调用一次、译文与原文入口、刷新回放，以及关闭翻译恢复旧流程。结果见 [浏览器记录](translation-browser.json)。
- 重启该 Web 服务后重新验证项目开关、自定义提示词及完整翻译链路，通过 [重启检查](translation-browser-restart.json)。最终打包与浏览器已验版本的运行代码相同，安装包中使用说明已同步为 rc.3。

本次使用 mock A/B，无真实模型调用。兼容范围精确声明为已验证的 rc.3，真实语言质量仍依赖具体模型和提示。
