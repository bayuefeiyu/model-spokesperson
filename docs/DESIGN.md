# 实现设计

已实现，目标 DSH 0.2.1-rc.3。验证范围见 `evidence/validation.md`。

```text
用户 → A 的正常 AgentLoop → 原始助手消息/工具事件 → 原会话日志
               │
               └ assistant-stream → Host 筛选 → B → 插件记录
                                                    │
                     原助手行 Client wrapper ← projection
```

## Host

不包装或替换 A 的 llm/stream，不修改冻结请求、assistant/message、reasoning、usage 或 replayState。观察跨作用域 agent 事件，用根 agent ID 和 session origin 排除子任务。start 读取 requestHeader.config 的实际路由，在任何正文 chunk 前记录 collecting。工具块立即 bypass，异常 finish 和失败 attempt 不请求 B。

通过 session/event 捕获已提交的助手消息，在 end frame 对照 seq；避免 append 发布中重入。B 只接收最新用户公开问题、A 的公开 text 和编辑指令，不接收隐藏思考、工具日志或完整历史。B 使用独立 ctx.llm.stream、tools:[] 和单条编辑数据消息，没有 agent loop。B/标题/摘要不会触发该 agent 的 stream，因此同路由 B 不递归。

状态按 agent / session / turn / step / attempt 隔离。FIFO 队列限并发，超时包含排队。新输入、显式取消、agent 销毁或卸载取消挂起任务；不遵守取消的 provider 的迟到结果也不能提交。失败回退不重跑 A，错误 reason 不包含 provider 异常细节。

## 记录和校验

`plugin:model-spokesperson/rewrite` 是版本 1 的 ignorable 实验性会话记录，保存消息 ID、SHA-256、原文、稿件、路由、attempt、状态、编辑输入、独立 usage 和时间。记录跟随会话保存/分叉/删除，无外置孤立 sidecar。先保存并 flush 已验证内容再公开 ready；重启不补请求，暂存稿通过校验则恢复，否则回退。

`modelSpokesperson` projection 增量派生 rows、latestUser、synced；wire 只发送 rows。使用官方 projection 与 Client useProjection，无自定义网络协议，不调用已弃用 snapshotEvents/eventAt。实验 API 固定到验证版本。

保护代码围栏、行内代码、链接、路径、数字、引用、选项标识及部分否定/未验证标记的内容与顺序。提问不能变为纯陈述。空输出、工具调用、异常/截断 finish、超预算、校验失败均回退。这不能证明所有自然语言完全等义。

## Client

在公开 slots.entries 中捕获官方 assistant-step renderer。打包客户端的 registrant 被压缩，不作稳定身份；以其拥有的 reasoning.body 和 message.images 子槽识别验证过的实现。以更低 priority 包装同一 keyed slot，只克隆用于展示的 text block。

子槽声明不能重复：wrapper 声明私有别名，镜像官方叶子注册，再把 Default 的 renderSlot 映射到别名。保留 locale/inject、默认思考与图片组件，监听注册变化，卸载清理订阅和镜像。不修改他人的注册对象。第三方含嵌套子槽的自定义 renderer 不在当前适配范围。

collecting/rewriting 隐藏正文、保留其余块；ready 原行显示 B，附原文折叠和独立复制。落库后必须匹配原消息 ID 和完整原文，否则直通。旧记录、工具、interrupted、重生成后的消息不串用稿件。宿主原有复制/轨迹/导出继续使用 A。

## 后续上下文

B 完成不唤醒 A。下次有真实输入的 agent/pre-step 等待本 agent 的整理结束或取消，使用 decision.messages 追加 notice，先记录再进入冻结请求。每个原消息 ID 只同步一次；只同步仍在当前消息面中的原消息，排除已删除/重生成的旧稿。notice 说明展示稿是引用资料而非新指令，A 原助手消息保留。

## 打包

从 0.1.1 起，仓库根清单直接声明 dsh.bundle.patch，根 cordis.patch.yml 使用 packages/host/lib 和 packages/ui/lib 的相对入口。Git 提交预构建 Host ESM 与 Client module-loader 产物，tarball 从同一根目录打包，不再单独生成另一份组合包清单。DSH/Cordis/React/Zod 全部 external，保留精确 peer/engine 兼容检查。隔离 home 放在提取 runtime 下，使插件共享宿主模块实例。
