# 实现决策

## D001 独立开发（2026-10-27，已采用）

安装目录只读；源码、依赖、测试 runtime 和用户数据均在本项目。用户本次已要求开发，授权范围涵盖本地实现与隔离验证，不包括日常桌面安装。

## D002 Host + Client 展示稿（2026-10-27，已验证）

保留 A 原始日志；B 为独立插件记录，Client 在原助手行显示。真实 AgentLoop 测试验证工具和 replayState 不变，浏览器验证 pending/替换/原文/刷新。未选择流替换，因为它混淆原始 provider 内容与元数据。

## D003 正式日志和 projection（2026-10-27，已采用）

用实验 appendPluginRecord 记录，用 sessionProjections 增量折叠。下次用户输入经 pre-step decision.messages 注入可回放 notice，无额外自动 turn。固定 rc.3 并保留实验性兼容边界，不使用弃用同步扫描接口。

## D004 默认 renderer 包装（2026-10-27，已验证）

使用公开 slot 注册表和原组件，保留 locale/inject，不复写 Markdown。实际打包 registrant 压缩为 Gb，改以公开子槽声明识别默认项。子槽声明不能重复，用私有别名镜像叶子组件和授权 renderSlot。Service 方法保留 receiver；真实 SlotCore 测试覆盖声明、委托和卸载。

## D005 安装包与模块身份（2026-10-27，已验证）

bundle 内携带两个实现包，patch 使用相对入口。开发 root 不设 npm workspaces，防 installation-first 选择开发链接。隔离 home 位于 runtime 下面，共享 DSH 模块；此前跨副本调用 Session 私有方法失败证明不能混用。保留 peer/engine 检查，不用强制安装绕过兼容。

## D006 恢复与回退（2026-10-27，已采用）

验证稿先 flush 再 ready。重启不请求历史 B；未完成记录恢复已验证暂存稿或回退。过期/取消结果不提交，失败不重做 A，provider 异常详情不入记录。精确关键片段规则保守拦截，但不声称证明自然语言等义。
