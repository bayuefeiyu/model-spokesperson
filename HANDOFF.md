# 开发交接

当前版本 0.1.2，针对 DSH 0.2.1-rc.3。交付安装包 dist/dsh-plugins-model-spokesperson-0.1.2.tgz；使用步骤见 README。前端插件详情页可直接配置 A/B、开关、文风和限额，见 evidence/settings-validation.md。0.1.1 已修复仓库 URL 安装问题。

## 已实现

精确路由、纯文字筛选、工具直通、无工具 B、预算/超时/取消/FIFO 并发、失败回退、独立 usage、原消息和 replayState 保留、插件记录持久化及 projection、原行展示/原文/复制、下次输入的日志化展示稿同步。未修改 agent-loop、日常 ASAR 或日常配置。

src/host.ts 是入口，contract.ts 管理版本和 schema，policy.ts 保护关键内容，projection.ts 增量折叠，client.ts 包装官方 slot，presentation.tsx 仅构造渲染副本。根 package.json 和 cordis.patch.yml 是唯一组合包入口，packages/host 与 packages/ui 含两个实现。预构建文件随源码提交，GitHub URL 安装不运行构建；scripts/pack.mjs 直接打包仓库根目录。

src/config.ts 声明原生 volatile 配置，保留 Schemastery 元数据并补足跨字段验证；Host 在每次 source attempt 开始时读取并冻结该次设置。settings-client.ts 通过 plugins.bundle.config 注册页面，settings-view.tsx 使用宿主 ConfigForm 做带 revision 的原子保存和模型目录选择。不要用 DOM 注入、localStorage 或第二份配置存储替代这些入口。

## 验证与复现

运行 npm run check / npm test / npm run build / npm run pack:plugin，前面加 rtk proxy。实际结果见 evidence/validation.md、browser-e2e.json、mock-chat.png。锁文件保留。没有真实模型费用。

隔离启动严格遵循 docs/DEVELOPMENT.md，不在用户日常 profile 中复现。profile 位于 .dev/runtime/spokesperson-home，默认工作区覆盖到 .dev/documents。早期 home 留在 .dev，非正式验收数据。

集成修复要点：不能用 workspace 链接遮蔽安装产物；包内相对入口和共享模块实例必须一致，否则 appendPluginRecord 的 Session 私有字段品牌不匹配。Client fiber 名被压缩，不能用 registrant 字符串找默认项；复制子槽声明会冲突，需要别名与叶子镜像。Service 方法调用要保留 receiver。

## 交付边界

真实 A/B provider/model 未指定，也无已授权账号测试配置，因此未验收真实表达质量、费用、延迟；用户配置后可继续这项，不阻塞 mock 开发交付。日常桌面安装仅在用户要求接入时执行。

主聊天 Web 是支持范围。CLI/SDK/导出/原有复制读取 A；专用按钮复制 B。历史分页、网络断线、多客户端和删除依赖宿主 projection/会话行为，目前测试覆盖范围必须以验收记录为准。含嵌套子槽的第三方 renderer、真实附件和压缩后长历史应另做实际环境回归。语义校验是保守规则，不能证明任意改写完全等义。
