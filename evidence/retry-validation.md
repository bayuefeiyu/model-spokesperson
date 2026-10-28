# 0.2.2 手动重试 B 验收

目标 DSH 0.2.1-rc.3。独立 home、profile spokesperson-report、工作目录/默认 Documents 和端口 31950。所有调用使用 mock，未调用真实付费模型，未修改日常安装包或日常 profile。

## 实现

失败提示旁提供“重试 B 回复”。原生 Typert Remote 使用严格请求 schema 和 Session 资源声明，客户端只发送当前查看会话与失败记录身份，不发送工作材料。Host 校验状态/计数、原文 ID/文本/hash、配置的源路由及空闲所有权，以 runMaintenance 运行 B，不开启 A 的新 turn。

默认复用连续成功阶段，从失败阶段继续；模型、提示词或输入改变时失效并重新执行对应阶段。重试读取当前设置，材料使用原报告前的快照。新记录在首次 B 调用前保存 context，旧 0.2.x 记录可以从第一请求或仍有效的原报告之前的历史恢复，不能纳入后来的对话。原文失效/材料不足、A 忙、禁用或重复请求会拒绝。

所有调用及 usage 保留，activeStages 指向当前实际采用的步骤，复用不重复统计费用。新输入/取消停止重试，失败保持 A 原文。恢复只认可完整最终稿，不自动补跑。Client 打包纯 remote-info 辅助模块并保留 MIT 许可，宿主服务继续共享 SDK；Client 同时声明父 remote 和 retry namespace 注入，避免加载或服务权限失败。

## 已执行检查

- Host/Client 类型检查、构建和打包通过。
- 46 项测试通过、0 失败；新增起草失败重试、连续核对失败续接与累计用量、配置改变、重复点击/新输入、旧记录与材料范围、A 忙/禁用、当前查看会话身份、按钮反馈及纯协议辅助模块打包回归。
- 实际 tarball 安装到隔离 profile。浏览器通过真实 /api/modelSpokesperson/retry 链路：核对失败只调用剩余两轮 B，不重复成功初稿；起草失败只调用 B 起草与两轮核对；没有重跑 A。成功结果在原行显示，刷新不增加模型调用。
- 准备一个已保存的核对失败会话，供进程重启/重新安装后的冷历史重试检查。结果以 retry-restart.json 和机器记录为准。
- GitHub 固定提交 09bceb2d33411c7ec667a4769a456ae6cda29ddd 重新安装并重启后，冷历史成功重试，只调用剩余两轮 B，未重跑 A 或初稿。刷新成功稿无新模型请求。原生管理器识别 0.2.2、两个组件和 Git 来源，启停通过。安装副本与本地构建逐文件摘要一致。

机器记录见 retry-validation.json、retry-browser.json、retry-restart.json；按钮截图为 retry-button.png。GitHub 分发与发行包验证写入机器记录。

已发布 [v0.2.2 预发行版](https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v0.2.2)，标签提交 66eb4c82768a22dadafc265bfa7377d7ed2bc07a。安装包 71692 字节，SHA-256 为 `83c48b24e28b5a32ab76ba0a3f178f3572042e0b6077427d86cde9073ccbc010`。安装包与 SHA256SUMS.txt 均通过 GitHub API 下载至内存复核，摘要与本地一致，仓库保持私有。

## 边界

旧 0.1.x 润色记录没有独立报告上下文，不提供本入口。原文已删除/重生成或材料不可恢复时不能重试。真实 API 断网、限额和模型语义质量未验证；mock 证明流程、调用数量和数据保存行为。分叉的当前会话身份有组件测试，完整分叉/删除/多客户端浏览器矩阵仍未扩展。手动重试会增加实际新调用的费用；未增加自动重试。
