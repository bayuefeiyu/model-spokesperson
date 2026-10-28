# 0.1.1 分发修复

日期：2026-10-28。目标 DSH 0.2.1-rc.3。

## 原因与复现

0.1.0 只有通过 scripts/pack.mjs 生成的 tarball 根清单声明了 dsh.bundle；GitHub 仓库根目录的 package.json 仍是 model-spokesperson-development 开发包。因此用户把仓库 URL 交给插件管理器时，它检查的是没有组合包声明的根清单。

使用独立 profile 从旧 GitHub commit 5e8f115 安装，实际得到普通依赖 model-spokesperson-development，并出现 `declares no dsh.bundle — installed as a plain dependency, not a profile layer`。此前 tarball 安装通过不能证明仓库 URL 可安装，原验收漏掉了该路径。

## 修复

- 仓库根 package.json 直接声明名称、0.1.1 版本、dsh.bundle.patch 和验证过的 DSH engine。
- 根 cordis.patch.yml 指向 packages/host/lib 和 packages/ui/lib，预构建入口随 Git 提交；无 prepare/install 生命周期构建要求。
- tarball 从相同仓库根目录打包，移除独立 packages/bundle 清单及 staging 布局，避免两份分发声明再次漂移。
- 增加 distribution.test.ts，使用宿主官方 bundlePatchPaths/loadOverlayPatches/composeEntries 检查根清单和可加载入口。
- README 增加 GitHub URL 安装方法；旧 model-spokesperson-development 普通依赖需移除后重装。

## 实际验证结果

- 类型检查、构建、20 项自动测试全部通过；新增测试检查根清单、官方 patch 解析以及预构建 Host/Client 入口。
- 0.1.1 tarball 在 spokesperson-github 隔离 profile 成功安装，原生插件管理器显示版本和 Host/UI 两个运行中组件，组合包开关可关闭并重新启用，浏览器无错误。
- 从用户原始 URL `https://github.com/bayuefeiyu/model-spokesperson` 直接重新安装，pnpm 锁定修复 commit `331a05fcba62d5ba5eb239298d59e53f00f8cdab`；宿主自动将 @dsh-plugins/model-spokesperson 加入 profile 的 bundles，没有 no dsh.bundle 警告。
- 对 GitHub 安装实例再次检查原生插件管理器：识别 0.1.1、展示两个组件、开关可关闭并重新启用，通过。结果见 plugin-manager-github.json 和 plugin-manager-tarball.json。
- 在同一个 GitHub 安装实例运行 browser-e2e：原文不闪现、B 原行展示、默认思考折叠、原文查看和刷新不新增模型调用全部通过，浏览器无错误。

隔离 home 为 .dev/runtime/spokesperson-home，profile 为 spokesperson-github，端口 31948，工作区在 .dev/documents。日常安装和用户 profile 未修改，无真实模型 API 调用。验证结束后停止本次 Web 服务。安装包摘要见 distribution-fix.json 与 Release 中的 SHA256SUMS.txt。

新发布的 v0.1.1 标签包含相同修复代码、组合包清单和预构建入口；追加的提交仅补全验收记录。0.1.0 的验证记录保持为历史快照，不据此声称旧仓库 URL 可安装。

## 发布

[v0.1.1](https://github.com/bayuefeiyu/model-spokesperson/releases/tag/v0.1.1) 已发布，标签对应 cf0388218d68da87311959d0d1e771625e7ec0b2。安装包和校验文件均已从 GitHub 下载复核。安装包 SHA-256 为 `8e43cbc477616405eb390e3eba93cd156b4482d71c3355e14157935866b1a0ec`。
