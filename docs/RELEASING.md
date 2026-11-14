# 版本发布

插件详情页读取公开 GitHub Releases，选择版本号最高且带 `.tgz` 安装包的正式版本。仅推送源码或 tag 不会提供可安装更新；应发布正式 Release，上传准确命名的安装包。

1. 统一根清单、Host/UI 清单及锁文件版本，确认目标 `engines.dsh` 和 SDK 兼容声明。
2. 完成类型检查、适用测试、构建、打包及隔离运行时验证，提交预构建产物并推送源码。安装包必须对应已验证的提交。
3. 创建该提交的 `vX.Y.Z` Release 草稿；填写变更、目标 DSH、升级步骤和实际验证边界。
4. 上传 `dsh-plugins-model-spokesperson-X.Y.Z.tgz` 与 `SHA256SUMS.txt`。核验附件大小及 SHA-256 后发布，设置 `draft: false`、`prerelease: false`。
5. 使用发布后的附件 URL 重新公开下载并核对 SHA-256。草稿附件 URL 含临时 `untagged-...`，发布后应重新读取元数据中的正式 URL。
6. 调用 `src/update.ts` 的 `fetchLatestRelease({ force: true })`，确认实际更新检查识别目标版本和正式安装包地址；检查旧版本满足 `isNewer`。
7. 在 TASKS/HANDOFF 与 evidence 中记录 Release、提交、附件摘要及验证结果，再向用户交付发布链接。

公开 API 的更新检查有五分钟缓存，用户可点击检查更新强制刷新。安装仍需用户点击更新按钮，插件不静默安装。当前 GitHub 连接工具不提供 Release 发布或附件上传接口；可使用已有本机 GitHub 认证调用 API，不输出或提交凭据。

0.3.5 示例和验证结果见 [发布证据](../evidence/release-0.3.5.json)。后续版本应根据当时工具及仓库状态执行，不能直接重跑旧版本的发布脚本覆盖已有附件或 tag。
