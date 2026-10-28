# 0.2.0 独立报告与多轮核对验收

日期：2026-10-28。目标 DSH 0.2.1-rc.3；隔离 Web/mock 运行时，独立 profile `spokesperson-report`、端口 31950。没有真实模型 API 调用；没有修改日常安装包或日常 profile。

## 实际实现

B 先读取 A 本次报告生成之前的有效工作快照，独立起草。后续核对调用才读取 A 报告，指令明确以 B 自己上一稿为底稿，核查遗漏、事实和状态，保持自己的结构与措辞。默认独立起草一次加核对一次；0 轮仅起草，多轮逐次完善 B 上一稿。

快照包含用户要求、公开工作记录、工具调用参数和实际结果；过滤 A 系统提示、隐藏推理和 replayState。历史已展示回复用匹配原消息的 B 版本替代，过滤重复同步通知。附件内容不可见时明确标记，不假装读取字节。已压缩的历史以宿主当前有效消息为准。

每步请求、输出、时间和已收到的用量独立保存，顶层汇总 B 的 token。未完成核对不展示初稿；失败回退 A，新输入/取消停止剩余步骤，迟到结果不能提交。v1 历史保留原恢复规则，v2 只有全部阶段及最终暂存稿完整时恢复 ready，不重请求历史模型。

## 已执行检查

- `rtk proxy npm run check`：Host/Client 类型检查通过。
- `rtk proxy npm test`：36 项通过，0 失败。
- `rtk proxy npm run build`：Host ESM 与 Client module-loader 构建通过。
- `rtk proxy npm run pack:plugin`：根组合包打包通过，安装到独立 profile，预构建文件与安装副本逐文件摘要比对。

新测试直接运行真实 AgentLoop/mock adapter：工具证据进入初稿请求、A 本次成稿排除、核对底稿连续、0/3 轮设置、空稿/截断/工具调用/异常回退、核对中新输入取消、超百万字符材料、100000 tokens 用户预算、自设核对预算超限不截断、旧历史与完整/不完整 v2 暂存恢复。保留精确路由、工具基线、A replay/usage、并发、原文展示、分叉及下一次真实输入同步等回归。

## 原生 Web 验收

- 从空设置在插件详情页选择 A/B、启用、设置文风和核对 2 轮，未保存不落盘；保存通过原生 ConfigForm 写入当前 profile。
- 下一次回复实际调用序列为 A/B/B/B；B 首次输入无 A 本次报告，第二次包含自己的初稿和 A 参考报告，第三次是第 2 轮核对。100000 tokens 设置实际进入 B 请求。
- 从前端关闭 B 后，下一次只调用 A；重新启用正常。
- 聊天依次显示独立起草和核对进度，候选 A 原文不闪现，中间稿不提前展示；最终 B 在原行显示，原文和原生思考折叠可用。
- mock `review-fail` 让初稿成功、首次核对失败：原行回退 A，只调用 A/B/B，没有重做 A。
- 刷新及进程重启后，已完成 B 稿直接回放，不增加模型调用；设置保留核对 2 轮和模型选择。
- 最终 tarball 安装后，原生插件管理器识别 0.2.0 和 Host/UI 两个组件，bundle 关闭再启用正常，无浏览器错误。
- GitHub URL 固定提交 3a93131bfdc1735c45360bdadfdde380714ace62 安装通过；插件管理器识别 Git 来源，设置保留，重新验证聊天起草/核对/原文/刷新。安装副本与构建产物逐文件摘要一致。

机器记录见 [report-validation.json](report-validation.json)、[设置](report-settings.json)、[重启](report-settings-restart.json)、[聊天](report-chat.json)、[核对失败](report-fallback.json)。界面截图：[设置](report-settings.png)、[聊天](report-chat.png)。分发与发布结果以机器记录的 `githubSource`/`release` 为准。

## GitHub 交付

私有仓库已发布 [v0.2.0 预发行版](https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v0.2.0)，标签指向提交 141c043f56ae173232dc0477bf0486f81e3df359。发行包 50883 字节，SHA-256 为 `d6387c0ad7ae00989e1d807d9eafe7fb242d01ad76fdcb076f0c539ba33b7ca4`，同时提供 SHA256SUMS.txt。两个附件均已通过 GitHub API 下载到内存复核，摘要与本地一致。

## 边界

没有配置真实 A/B，因此未验证真实独立写作、保留 B 文风、事实纠错的质量、费用和延迟。mock 只验证输入隔离、提示内容、调用链及展示/持久化行为，不能证明模型一定遵守指令。新报告允许独立组织，不再以 A 成稿的数字与代码顺序作等同性校验。

当前仍仅适配主聊天 Web。CLI/SDK/导出读取 A 原始记录。真实附件、多客户端断线、长历史分页和完整删除/重生成浏览器矩阵未扩展验证；A 未写入先前记录的内部结论不能自动移交给 B 第一步。
