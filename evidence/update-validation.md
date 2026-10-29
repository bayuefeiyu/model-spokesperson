# 0.2.3 一键更新验收

日期：2026-10-28

目标：DSH 0.2.1-rc.3，插件 0.2.3（本地构建；GitHub 最近公开 Release 为 0.2.2）。

隔离环境：`.dev/runtime/spokesperson-home/profiles/spokesperson-report`，Web 端口 31950，mock A/B，不调用真实收费模型；日常 desktop profile 未改动。

## 实现范围

- 公开仓库后，Client 直接读取 `https://api.github.com/repos/bayuefeiyu/model-spokesperson/releases`，不增加 Host 路由、token 或第二份版本存储。
- 只接受带 `dsh-plugins-model-spokesperson-X.Y.Z.tgz` 资产的稳定 Release；按 semver 选择最高版本；忽略 draft、无资产和 prerelease tag。
- 更新控件注册在 `plugins.detail.actions`，只对 `@dsh-plugins/model-spokesperson` 且已安装的 bundle 渲染；检查、按钮和错误都留在插件详情页。
- 点击后调用原生 `pluginManager.installBundle`，spec 为 Release 的 npm tarball URL；不调用 `removeBundle`。tarball spec 改变依赖字符串并跳过 Host 固定的五秒 Git 连接预检，安装后由 Host 判断 HMR 或 `restart-required`。
- 请求 10 秒超时、结果缓存 5 分钟；网络、限流、无稳定 Release、不兼容等保留原版本并显示原因。没有静默自动安装。

## 自动检查

```powershell
rtk proxy npm run check   # 通过，0 错误
rtk proxy npm test        # 56 项通过，0 失败
rtk proxy npm run build   # 通过
rtk proxy npm run pack:plugin
```

0.2.3 安装包 `dist/dsh-plugins-model-spokesperson-0.2.3.tgz`，83850 字节，SHA-256 `feb9396adf3f64c6e6c3f75af270ec4c5da49b44f24724928c84e126ac1b6f97`。

- 新增测试覆盖 semver、Release/资产筛选、缓存、网络/限流/无资产回退，以及更新成功、restart-required、安装失败、检查失败重试、非本 bundle 不渲染。
- 早期的 tag 版本检查曾在 0.2.3 上返回“已是最新 v0.2.3”。改为 Release 资产端点后，连续浏览器测试触发 GitHub 未认证 API 限流（403），因此最终确定性检查使用 Playwright 拦截 release 元数据；这只替代元数据请求，安装仍使用真实公开资产。

## 一键覆盖安装

`scripts/browser-update-e2e.mjs` 使用带 0.2.3 更新代码、根版本号为 0.2.1 的测试候选：

1. 详情页显示当前 `v0.2.1` 和“更新到 v0.2.2”。
2. 点击后安装公开 Release 资产 `dsh-plugins-model-spokesperson-0.2.2.tgz`，未先卸载自身。
3. 页面随后显示 `v0.2.2`，来源为 release tarball；没有 page error。
4. 表达偏好仍为“结论先行，保留事实。”，核对轮数仍为 2，A/B 映射仍在。

结果见 [update-e2e.json](update-e2e.json) 和 [update-e2e.png](update-e2e.png)。更新元数据由 Playwright 拦截以避免限流；安装下载的是真实公开 Release 资产。

最终 0.2.3 构建在隔离 profile 中打开详情页，显示“已是最新 v0.2.3”，无 page error；fixture 仅提供 `v0.2.2` 元数据。见 [update-final-check.json](update-final-check.json) 和 [update-action.png](update-action.png)。

## 限制与未覆盖

上传前复核（2026-10-29）：重新执行 `npm run check`、`npm test`、`npm run build`、`npm run pack:plugin`，类型检查、56 项测试和构建全部通过。重新打包仍为 83850 字节，摘要与上述安装包记录一致。本次未重跑浏览器，浏览器结果为上次外部开发保留的验收记录。

- 0.2.3 尚未创建 GitHub tag/Release；需要发布后，0.2.2 用户先手动安装一次 0.2.3，之后的新版本才能一键更新。
- 没有在真实桌面日常 profile 安装 0.2.3；没有真实 A/B provider 成本或延迟验收。
- GitHub 未认证 API 有按 IP 的限流；UI 显示可读错误并保留原版本，尚未加入 token 配置。
- 浏览器 Client 是否需要完整刷新、Host 是否 HMR 原地重组取决于运行时组合；E2E 观察到了页面版本更新，但没有逐帧区分 HMR 与整页重载。
- `restart-required`、`incompatible-version` 的 UI 分支由 React 测试覆盖，未在真实 DSH 不兼容版本上制造回归。
