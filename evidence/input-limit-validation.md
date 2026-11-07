# 0.2.4 输入超限与重试反馈

日期：2026-10-29。目标 DSH 0.2.1-rc.3。本版本仅完成本地开发与隔离验证，未推送或发布 GitHub Release，未替换日常插件。

## 诊断

只读用户指定会话的本地 projection 缓存与当前 Host 配置。共 219 条插件状态，其中 217 条为工具调用直通，前一次报告已有 ready B，后一次报告为 fallback / input-limit。后一次工作上下文 JSON 长度 1,069,622 字符，尚未计入阶段提示词；用户当前 maxInputChars 为 1,000,000。该条已重试 23 次，且没有任何 B stage 请求记录，说明在调用模型前即被插件限额拦截。

现有恢复步骤：在原生插件设置的高级设置将“每次输入字符上限”改为 0 或提高预算，保存后点击“重试 B 回复”。字符限额与模型 token 上下文窗口是不同计量。没有修改用户日常设置、会话或安装文件，没有调用真实 A/B，也没有保存或提交用户正文、提示词、密钥及服务账号。

## 修复

- 新的超限记录保存 inputBudget.chars/limit 与正确阶段；失败行显示安全原因和设置入口。
- 兼容旧记录，旧超限行提示原因；点击时按当前设置计算具体预算并返回可见提示。
- 重试先检查下一未复用阶段；仍超限时不取得 maintenance、不增加计数、不请求模型。
- 调大预算或改为 0 后，仅恢复 B；核对超限可复用完整的成功初稿。
- 输入仍按用户预算处理，不截断材料或擅自放宽已保存设置。原生 provider 能力继续生效。

## 实际验证

- `rtk proxy npm run check`：Host/Client 类型检查通过。
- `rtk proxy npm test`：58/58 通过。新增超过百万字符的起草超限、旧无指标记录、重复无效重试、解除限制仅恢复 B；扩展核对超限复用初稿、计数与阶段、前端可读提示和未知错误不外露的测试。
- `rtk proxy npm run build` / `rtk proxy npm run pack:plugin`：成功。
- 将真实 tarball 安装到项目 `.dev/runtime/spokesperson-home` 的 `spokesperson-report` 隔离 profile，使用端口 31950、mock 模型、项目内 workspace/Documents，运行 `scripts/browser-input-limit.mjs`：原生设置保存 1000、聊天显示实际字符数、重试预算错误可见且无 B 调用；保存 0 后同一回复成功，仅增加 B 起草/核对两次调用；刷新无额外调用。见 [机器结果](input-limit-browser.json) 和 [截图](input-limit.png)。
- 首次浏览器尝试在即时超限后过快点击，收到“请等待 A 完成当前工作后再重试”；脚本随后等待 A driver 清理再检查预算错误。最终浏览器无页面异常，真实 API 调用 0。
- 验证后停止本次隔离服务，隔离 profile 恢复原输入预算/核对轮数。最终包仅 README 示例路径相较浏览器安装包更新，Host/Client 运行文件相同。

安装包：`dist/dsh-plugins-model-spokesperson-0.2.4.tgz`，86,979 字节。

SHA-256：`504e5efe240974d8e5d489cc02a81db8c6dac39f9a24de2a0837f26c78510568`。

真实模型输出质量、该用户会话解除限额后的真实 B 结果与提供方窗口是否足够未验证；本次没有付费模型调用。
