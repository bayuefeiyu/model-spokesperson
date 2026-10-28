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

## 当前验证

类型检查、构建、20 项自动测试通过。0.1.1 tarball 已在 spokesperson-github 隔离 profile 安装，Web 端口 31948 的原生插件管理器显示版本及 Host/UI 两个运行中组件。

后续 GitHub URL 直接安装、管理器启停和浏览器回归结果将在本次发布前补入本记录。日常安装和用户 profile 未修改，无真实模型 API 调用。
