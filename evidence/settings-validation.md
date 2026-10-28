# 0.1.2 前端设置验收

日期：2026-10-28。DSH 0.2.1-rc.3，Node 24.20.0。

## 功能入口

插件 → @dsh-plugins/model-spokesperson → 模型与表达。界面可添加多组 A/B 映射、开启文字整理、编辑表达偏好，以及超时、并发、输入字符和输出 token 限额。模型从 DSH 已配置的 provider/model 目录选择；这里只定义整理规则，不自动切换聊天模型。

设置通过原生 plugins.bundle.config、ConfigForm 和 Settings 服务写入当前 profile，使用读取时的 revision 防止覆盖并发修改。所有字段为原生 volatile Config 引用，Host 每次 source attempt 捕获独立设置快照；进行中的整理保留原设置，后续回复使用新设置。

## 实际验证

- Host/Client 类型检查通过。
- 26 项自动测试通过、0 失败。新增验证配置引用及跨字段检查、前端草稿和原子保存、重复路由、并发冲突、保存失败保留草稿、目录不可用时保留原路由、动态并发限制，以及关闭后继续同步历史展示稿。
- 从默认关闭且无映射的隔离配置开始，在原生插件详情页选择 mock A/B、开启整理、修改文风及输出限额；保存前 profile 文件不变，保存后真实写入。结果见 settings-ui.json。
- 刷新浏览器，A/B、开关和文风保留。
- 无需重启，下一条回复实际调用 mock a 和 b；B 请求使用新文风和 256 token 输出限额。关闭整理后下一条回复只调用 a。
- 重启整个服务，已保存配置仍保留。结果见 settings-restart.json。
- 原生插件管理器的组合包关闭/重新启用和既有聊天 e2e 仍通过，浏览器均无 pageerror 或 console error。
- 最终 tarball 重新安装后配置和聊天回归通过，安装内容与构建产物逐项摘要一致。随后直接从 GitHub 仓库 URL 安装 feature commit 655efbd，原生设置页面、保存配置恢复与管理器启停再次通过。

隔离 profile 为 spokesperson-ui，home 在 .dev/runtime/spokesperson-home，Web 端口 31949，工作区在 .dev/documents。仅调用本地 mock，没有真实模型费用，没有修改日常桌面配置。截图见 settings-ui.png。既有真实模型、完整桌面/附件/多客户端质量验收边界保持不变。

## 发布前复核

最终安装包及 GitHub 发布信息在本次交付前补入 settings-validation.json。更新后的预构建入口随 Git 提交，安装不要求执行构建。
