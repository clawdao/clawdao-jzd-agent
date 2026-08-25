# ClawDao v1.0.27 更新说明

> 发版日期：2026-08-25 · 配套 RELEASE-NOTES-v1.0.27-followup.md

## 一句话总结

把 v1.0.27 ship 后发现的所有体验问题、模型管理混乱、CEO 聊天体感 bug 一次性修完；自动更新改为始终运行、给升级失败留了"去下载页"逃生口。

## 10 条核心更新

1. **模型管理统一调度入口** — 5 个能力（对话 / 全模态 / 向量化 / TTS / ASR）收敛到统一调度，`models.json` 为唯一真值，凭证以 sidecar `auth.json` 为唯一真值。UI 明示密钥落点，远程模型 tab 顶部加说明卡片。

2. **知识库 embedding 设置合并** — 之前藏得很深的独立小面板合并进主模型管理 tab，跟着统一调度走，不再跟主设置脱节。旧目录会话自动迁移。

3. **CEO 聊天身份误报修复** — sidecar session 重建时模型身份没刷新导致的"我用的是 DeepSeek 但设的是 Claude"问题已彻底修好。

4. **CEO 执行步骤历史可见** — 之前 bash tool_call 事件不通知到 chat、步骤历史是空的；这次修核心订阅链，执行任何工具的每一步你都能看到。

5. **CEO 4 个 toggle + 斜杠命令重做** — 思考 / 授权 / 适配 / 目标 4 个 toggle + popover 实渲染，`/` 斜杠命令端到端打通；图标 + 文字 + 配色严格区分"开 / 关"状态。

6. **CEO 流式生成可中断 / 排队 / 接管** — 按 stop 不丢草稿；同一会话排队的请求可"中断当前 + 起下一条"或"接着当前"；输入框写了一半刷新或 cancel 都不丢；会话可手动命名。

7. **应用市场免费应用直装桌面端** — 免费应用直接唤起 ClawDao 桌面端完成安装，不再绕 ddn-hub 登录页；付费 / 积分类因需支付仍走后端。

8. **导入 URL 失败提示修复** — 之前 console 报错、前端无提示、按钮一直转；现在 inline 红色错误信息显示具体原因，按钮解锁，弹窗保留让你改 URL 重试。

9. **自动更新始终运行 + 升级失败逃生口** — 周期性检查始终开（不再被开关控制），发现新版本时显示红点 badge；下载仍受 autoDownload 控制。升级失败弹窗始终有"打开下载页"按钮跳 ddn.net/download。macOS DMG 自动签 + build timeout 4h；升级私钥 / pubkey / env 三方一致性校验。

10. **Windows 平台消息气泡 UI 对齐** — Windows 下消息气泡背景 / 间距跟 macOS / Linux 对齐；cargo build 同步触发 windows-schema.json 重新生成 + 补 9 条 deep-link permission。

## 升级建议

| 场景 | 动作 |
|------|------|
| 普通个人用户 | 无 |
| 多个 LLM 切换使用 | 重新检查"设置 → 模型管理"每个 capability 的 active entry；KB embedding 自动迁移 |
| 之前跳过 home 目录迁移 | 自动迁移会跑一次，旧目录会话合并到 `~/ClawDao/sessions/`，**不会丢历史** |
| 之前关掉了"自动检查"开关 | 升级后自动检查 + 红点 badge；下载仍受你之前的 autoDownload 设置控制 |
| Windows 用户 | 直接升级，会话回复消息 UI 视觉会更对齐 macOS / Linux |
| 升级到一半失败 | 弹窗"打开下载页"按钮跳 ddn.net/download 拿完整安装包手动装 |

## 已知问题

- 3D 数字人（VRM / Live2D）已不在 v1.0.27 之后的桌面端主路径；本地 B2 视频需部署 liveact-server Docker。
- pre-existing 1 个测试失败（task-processor.test.ts vi.getTimerCount 假阳性）— 与本次发版无关，单独修复中。