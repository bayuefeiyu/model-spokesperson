# 0.3.1 适配 DSH 0.2.2-rc.1

日期：2026-11-07。日常安装从 DSH 0.2.1-rc.3（build `be72761`）升至 **0.2.2-rc.1**（build `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`）。本版本只完成本地源码、SDK、测试和打包适配；未安装到日常 desktop profile，未发布 Release。

## 环境

- 安装：`G:\ai\harness\dsh desktop`，只读检查；ASAR 报告见 [runtime-inspection.json](runtime-inspection.json)。
- Node 24.20.0；Cordis 4.1.0、Cosmokit 1.9.0、Schemastery 3.19.0、Zod 4.4.3。
- 插件 devDependencies 全部从 `0.2.1-rc.3` 升到 `0.2.2-rc.1`；根清单和 host/ui 子包的 `engines.dsh`/peerDependencies 同步更新。
- 重新生成 `package-lock.json` 和 `node_modules`，没有使用 `--force` 或 `--legacy-peer-deps` 绕过兼容检查。

## 代码兼容改动

1. **sessionProjections API**：0.2.2 的 `register()` 返回 `Promise<ProjectionHandle<S>>`，废弃了按 key 的 `stateOf(session, key)`。Host `apply` 改为 async，等待注册后保存 handle；所有读取改用 `projection.stateOf(session)`。`SessionProjectionMap` 只保留 wire 值，移除了旧 `SessionProjectionStateMap` 声明。
2. **模型切换**：0.2.2 在 step preparation 后拒绝 `agent/request` 改 provider/model，错误要求先 `agent.model.select()`。旧测试的 `agent/request` 改路由方式已替换为 `agent.model.select()`；插件保留对组装路由与实际 `requestHeader` 的复核，作为旧版/允许该改法组合的防御。
3. **客户端/构建**：SlotCore、ConfigForm、plugin manager 和 remote 测试在新 SDK 下全部通过；Host/Client 构建仍把 SDK、Cordis、React、Zod 作为 external。

## 实际检查

- `rtk proxy npm run check`：Host/Client 类型检查通过。
- `rtk proxy npm test`：**70/70 通过**（DSH 0.2.2-rc.1）。
- `rtk proxy npm run build`：Host ESM + Client module-loader 构建通过。
- `rtk proxy npm run pack:plugin`：生成 `dist/dsh-plugins-model-spokesperson-0.3.1.tgz`，101,479 字节。
- SHA-256：`643db1dd54152b02a9eb6e928c90ce65ae9bc5bf252f6900b4abdf98707c3401`，已写入 `dist/SHA256SUMS.txt`。
- 将 0.3.1 tarball 安装到隔离 profile `spokesperson-report`：`node scripts/dev-cli.mjs --profile spokesperson-report --dump-config` 退出码 0，Host/UI 条目正确；旧 0.2.4 的版本不兼容提示消失。
- 在隔离 profile 启动端口 31951，`/` 返回 200；`scripts/browser-smoke.mjs` 无 pageerror/console error。没有进一步点击项目选择或保存翻译设置。

## 边界

- 没有调用真实收费 A/B 模型；英文遵循率、译文质量、延迟和费用未验收。
- 没有在隔离 Web profile 安装 0.3.1 并点击项目选择/翻译链路；React、ConfigForm、SlotCore、真实 AgentLoop 和打包测试已通过。
- 没有安装到日常 desktop profile，也没有创建 0.3.1 tag 或 GitHub Release。
- 0.3.0 安装包仍保留，目标为 DSH 0.2.1-rc.3；0.3.1 是当前 0.2.2-rc.1 适配版。
