# 开发交接

用户要求完成开发，现已实现 Host + Web Client bundle 0.1.0，针对 DSH 0.2.1-rc.3。交付安装包 dist/dsh-plugins-model-spokesperson-0.1.0.tgz；使用步骤见 README。

## 已实现

精确路由、纯文字筛选、工具直通、无工具 B、预算/超时/取消/FIFO 并发、失败回退、独立 usage、原消息和 replayState 保留、插件记录持久化及 projection、原行展示/原文/复制、下次输入的日志化展示稿同步。未修改 agent-loop、日常 ASAR 或日常配置。

src/host.ts 是入口，contract.ts 管理版本和 schema，policy.ts 保护关键内容，projection.ts 增量折叠，client.ts 包装官方 slot，presentation.tsx 仅构造渲染副本。packages 为两个实现包和一个内含依赖的 bundle；scripts 提供构建、打包、ASAR 检查、运行时复制、隔离启动、mock 和浏览器验收。

## 验证与复现

运行 npm run check / npm test / npm run build / npm run pack:plugin，前面加 rtk proxy。实际结果见 evidence/validation.md、browser-e2e.json、mock-chat.png。锁文件保留。没有真实模型费用。

隔离启动严格遵循 docs/DEVELOPMENT.md，不在用户日常 profile 中复现。profile 位于 .dev/runtime/spokesperson-home，默认工作区覆盖到 .dev/documents。早期 home 留在 .dev，非正式验收数据。

集成修复要点：不能用 workspace 链接遮蔽安装产物；包内相对入口和共享模块实例必须一致，否则 appendPluginRecord 的 Session 私有字段品牌不匹配。Client fiber 名被压缩，不能用 registrant 字符串找默认项；复制子槽声明会冲突，需要别名与叶子镜像。Service 方法调用要保留 receiver。

## 交付边界

真实 A/B provider/model 未指定，也无已授权账号测试配置，因此未验收真实表达质量、费用、延迟；用户配置后可继续这项，不阻塞 mock 开发交付。日常桌面安装仅在用户要求接入时执行。

主聊天 Web 是支持范围。CLI/SDK/导出/原有复制读取 A；专用按钮复制 B。历史分页、网络断线、多客户端和删除依赖宿主 projection/会话行为，目前测试覆盖范围必须以验收记录为准。含嵌套子槽的第三方 renderer、真实附件和压缩后长历史应另做实际环境回归。语义校验是保守规则，不能证明任意改写完全等义。
