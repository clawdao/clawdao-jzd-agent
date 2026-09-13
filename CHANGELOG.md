# 变更日志

所有版本的显著变更都记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 🆕 **素材上传功能（`jzd upload`）**：
  - `lib/materials.mjs` 新模块，封装 `MaterialManager`（基于已验证的 `POST /api/v1/material/files/upload`）
  - CLI 子命令 `jzd upload <file>...`：单/批量上传、自动去重、支持 image/video/file
  - 三种输出模式：人类可读、`--json`（结构化）、`--json-only`（每行一个 URL，脚本友好）
  - `jzd upload --check` 健康检查（无需真实文件）
  - `scripts/publisher.mjs` 重构：删除内联 multipart 代码，改用 `MaterialManager.uploadBatch()`，自动去重 + 错误聚合
  - 删除 `tmp/probe_upload{2..9}.mjs`：8 次路径猜测已沉淀为正式 API（`probe_upload9` 即正解），保留 `tmp/outputs/` 排除目录
- 🆕 **产品版本发布功能（`jzd version`）**：
  - `lib/versions.mjs` 完整模块，封装 DDN Hub 产品版本 API（15+ 端点）
  - CLI 子命令：`list / get / create / release / sync-s3 / publish / manifest / summary / health / remove`
  - 一键发布 `jzd version release --product-key clawdao --version 1.0.27 --notes '...'`：整理字段 + POST 创建 + 同步 S3
  - 已知 productKey 常量（`KNOWN_PRODUCT_IDS`）：`clawdao / limschain / ddn / ddn-ubl`
  - 同步 S3 端点：`POST /api/v1/product/download-assets/sync-from-s3`
- `tests/smoke.mjs` 烟雾测试（npm run test:smoke），覆盖模块加载 + 工具函数 + 客户端 fail-soft + 验证
- `package.json` 新增 `jzd / lint / test:smoke` 脚本

### 修复
- `package.json` 的 `"start": "node ./bin/jzd-ops.mjs"` —— 文件不存在！修正为 `./bin/jzd.mjs`

### 清理
- 🗑️ 删除 8 个 `tmp/probe_upload{2..9}.mjs`：曾经手工探查上传接口路径的试错脚本。已找到正解（`/api/v1/material/files/upload`）并封装为 `MaterialManager`，无需再保留一次性探针。
- `bin/jzd.mjs` import 列表新增 `basename` 工具（`handleUpload` 用到）

### 改进
- README 待更新（新增 version 模块使用示例）—— **本变更日志已记录**
- README 已补充 `jzd upload` / `MaterialManager` / `scripts/publisher.mjs` 的使用示例

## [0.1.0] - 2026-08-17

### 新增
- 觉知岛运营助手 CLI：`article / course / feedback / marketplace` 四大模块
- 零依赖 .env 加载器
- `bin/jzd.mjs` CLI 入口
- `lib/client.mjs` JzdClient（Bearer + X-Dao-Id）
- MarketplaceManager（应用市场上架规范强制 README + License）
- clawdao-jzd-agent 重命名自 clawdao-jzd-ops

[Unreleased]: https://github.com/clawdao/clawdao-jzd-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/clawdao/clawdao-jzd-agent/releases/tag/v0.1.0