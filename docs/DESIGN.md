# 实现设计

当前 0.2.1，目标 DSH 0.2.1-rc.3。独立报告流程验收见 `evidence/report-validation.md`，提示词设置见 `evidence/prompt-validation.md`；`evidence/validation.md` 与 `settings-validation.md` 是旧版本证据。

```text
用户 → A 的正常 AgentLoop → 原始助手消息/工具事件 → 原会话日志
               │
               └ attempt start → 捕获成稿前工作上下文
                         │
                   A 正常结束、无工具
                         ↓
                   B 独立起草（无 A 本次报告）
                         ↓
                   B 核对 0..N 轮（自己的上一稿 + A 参考报告 + 工作上下文）
                         ↓
                   插件记录 / projection → 原助手行 Client wrapper
```

## Host

不包装或替换 A 的 llm/stream，不修改冻结请求、assistant/message、reasoning、usage 或 replayState。观察跨作用域 agent 事件，用根 agent ID 和 session origin 排除子任务。start 读取 requestHeader.config 的实际路由，在任何正文 chunk 前记录 collecting。工具块立即 bypass，异常 finish 和失败 attempt 不请求 B。

通过 session/event 捕获已提交的助手消息，在 end frame 对照 seq；避免 append 发布中重入。每次 start 用公开 session.deriveMessages() 建立不可变材料快照，此时当前 assistant/message 尚未存在。`captureWorkContext` 提供用户要求、此前公开工作记录、实际工具调用参数和结果，排除 system/developer、内部推理和 provider replayState。已显示的历史回复只有 ID 和原文匹配时才用 B 正文替代；过滤重复的展示稿同步通知。附件只记录内容不可见，不声称读取附件字节。

B 第一请求只有 userQuestion/workContext，没有 A 本次报告。第一步成功后，review 输入增加 ownDraft/sourceReport/reviewRound，每轮以 B 上一步输出为 ownDraft，工作证据不变。B 使用独立 ctx.llm.stream、tools:[] 和单条有来源的 JSON 材料消息，没有 agent loop；不直接继承 A 的系统角色与写作习惯。B/标题/摘要不会触发该 agent 的 stream，因此同路由 B 不递归。

核对指令要求保留 B 的结构和措辞，以工作证据核对 A 报告中的差异，不能直接把 A 的全部断言视为事实。新稿不使用旧版逐项相等校验；允许有依据地补充、合并、重排数字和代码周围的说明。形式检查只确保正常结束、非空文本、不调用工具、不产生其他块，不能证明事实正确。旧版校验仅用于 policyVersion 1 历史恢复。

0.2.1 将完整起草和核对指令开放为 draftPrompt/reviewPrompt，缺失字段回填内置默认全文。配置为 volatile，单次 attempt 设置快照固定全部核对阶段的文本，保存只改变后续回复。用户提示词完整替换对应阶段默认内容，末尾只加 style；字段不作模板插值。原生编辑器预填实际文本、拒绝空白、逐项恢复默认，恢复仍按普通草稿原子保存。promptVersion 2 继续表示数据协议，实际提示词由各 stage.system 记录。

状态按 agent / session / turn / step / attempt 隔离。FIFO 队列限并发，超时包含排队。新输入、显式取消、agent 销毁或卸载取消挂起任务；不遵守取消的 provider 的迟到结果也不能提交。失败回退不重跑 A，错误 reason 不包含 provider 异常细节。

## 记录和校验

`plugin:model-spokesperson/rewrite` 继续使用 schemaVersion 1 的 ignorable 实验性记录；新增 policyVersion/promptVersion 2 和可选 stages/phase/reviewRound/reviewRounds，兼容旧记录。每步保存 system、完整 JSON 输入、开始/结束时间、成功输出和已收到的 usage；顶层 usage 汇总各步，A 的用量不混入。B 第一步输入是可回放的工作快照，不再依赖下一次读取的活跃会话。

记录跟随会话保存/分叉/删除，无外置孤立 sidecar。只有全部步骤成功后才写入 rewrittenText，flush 后公开 ready。重启不补请求；v2 只有完整 stages 和已暂存最终正文才能恢复 ready，只有初稿或不完整核对一律回退。用户新输入、取消、卸载取消后续步骤，迟到输出不能提交。失败保留内部诊断步骤，但不公开未核对初稿。

`modelSpokesperson` projection 增量派生 rows、latestUser、synced；wire 排除完整 requests/stages，聊天只接收展示必要字段与进度。使用官方 projection 与 Client useProjection，无自定义网络协议，不调用已弃用 snapshotEvents/eventAt。实验 API 固定到验证版本。

reviewRounds 默认 1，可为 0 或多轮。maxInputChars/timeoutMs 默认 0 表示插件不额外限制；maxOutputTokens 为 0 时省略调用覆盖，跟随模型默认。正数是用户明确预算，输入按每步 system + JSON 总字符检查，不截断工作材料；移除旧的输出字符隐含上限。宿主/provider 自身能力与资源限制仍然生效。配置沿用旧显式值，不擅自放宽已有用户预算。

## Client

在公开 slots.entries 中捕获官方 assistant-step renderer。打包客户端的 registrant 被压缩，不作稳定身份；以其拥有的 reasoning.body 和 message.images 子槽识别验证过的实现。以更低 priority 包装同一 keyed slot，只克隆用于展示的 text block。

子槽声明不能重复：wrapper 声明私有别名，镜像官方叶子注册，再把 Default 的 renderSlot 映射到别名。保留 locale/inject、默认思考与图片组件，监听注册变化，卸载清理订阅和镜像。不修改他人的注册对象。第三方含嵌套子槽的自定义 renderer 不在当前适配范围。

collecting/rewriting 隐藏正文、保留其余块；v2 按 phase 显示等待 A、B 独立起草、B 核对第 n/N 轮，不展示中间稿。ready 原行显示最终 B，附原文折叠和独立复制。落库后必须匹配原消息 ID 和完整原文，否则直通。旧记录、工具、interrupted、重生成后的消息不串用稿件。宿主原有复制/轨迹/导出继续使用 A。

## 后续上下文

B 完成不唤醒 A。下次有真实输入的 agent/pre-step 等待本 agent 的整理结束或取消，使用 decision.messages 追加 notice，先记录再进入冻结请求。每个原消息 ID 只同步一次；只同步仍在当前消息面中的原消息，排除已删除/重生成的旧稿。notice 说明展示稿是引用资料而非新指令，A 原助手消息保留。

## 前端配置（0.1.2）

Host 字段使用宿主原生 volatile Config 引用，通过可选 Settings 服务声明自带页面。保持 Schemastery 的标准 schema 与元数据，并在标准验证入口补充 enabled/rules、重复路由等跨字段校验，拒绝无效更新。每次 source attempt 捕获独立配置快照；保存只影响后续回复，不重新执行 A 或改变进行中的 B。队列容量按后续配置调整，缩小限额不额外启动排队任务。

Client 在 plugins.bundle.config 按包名注册页面，namespace 为 model-spokesperson-host，ConfigForm 是唯一读写入口。界面将编辑保留在草稿中，保存时以原 revision 提交一组 changed-field 操作，冲突或失败保留草稿。模型来自 remote.session.modelCatalog，不包含密钥；目录读取失败或缺少某条历史路由不删除既有选择。刷新/重启使用宿主 profile 配置，不维护浏览器私有副本。0.2.0 增加核对轮数、实际调用次数说明与 0 值预算语义。

## 打包

从 0.1.1 起，仓库根清单直接声明 dsh.bundle.patch，根 cordis.patch.yml 使用 packages/host/lib 和 packages/ui/lib 的相对入口。Git 提交预构建 Host ESM 与 Client module-loader 产物，tarball 从同一根目录打包，不再单独生成另一份组合包清单。DSH/Cordis/React/Zod 全部 external，保留精确 peer/engine 兼容检查。隔离 home 放在提取 runtime 下，使插件共享宿主模块实例。
