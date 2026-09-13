# clawdao-jzd-agent · 觉知岛智能体

> 通过命令行操作觉知岛（DDN Hub）SaaS 平台的运营工具：**文章 / 课程 / 应用市场 / 反馈 一体化管理**。

![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D18-blue)

> 🔧 **本项目由 ClawDao 龙虾岛（ClawDao Lobster Island）自动生成和维护，并可由它安装和运行。**

## ✨ 功能特性

| 模块 | 能力 |
| --- | --- |
| 📄 **文章管理** | 上传 / 列表 / 发布 / 删除文章，多状态筛选 |
| 📚 **课程管理** | 上传 / 列表 / 发布 / 分类管理 |
| 🧩 **应用市场** | 浏览 / 统计市场资产、上架应用、编辑资产、状态与精选管理（`marketplace` 命令） |
| 💬 **反馈提交** | 建议 / 问题报告 / 功能请求 |
| 🖼️ **素材上传** | 图片 / 视频 / 文件一键上传到觉知岛素材库（`upload` 命令） |
| 🔍 **健康检查** | API 连接状态诊断 |

## 🔐 凭证配置（安全）

CLI 通过环境变量连接 API，支持两种方式：

**方式 A：`.env` 文件（推荐）** — 项目自动加载

```bash
# 从 ClawDao 桌面应用一键同步登录凭证（不打印明文，权限 600）
node scripts/export-ddn-env.mjs

# 或手动创建 .env
echo "DDN_HUB_BASE_URL=https://ddn.net" >> .env
echo "DDN_HUB_AUTH_TOKEN=your_token" >> .env
echo "DDN_HUB_DAO_ID=your_dao_id" >> .env
chmod 600 .env
```

**方式 B：环境变量**

```bash
export DDN_HUB_BASE_URL=https://ddn.net
export DDN_HUB_AUTH_TOKEN=your_token_here
export DDN_HUB_DAO_ID=your_dao_id
```

> ⚠️ `.env` 已被 `.gitignore` 忽略，**严禁提交**。token 请勿在会话/日志中明文记录。

## 🚀 快速开始

```bash
# 本地使用
node bin/jzd.mjs --help

# 或全局 link
npm link
jzd --help
```

## 💻 使用示例

```bash
# 健康检查
jzd health

# 文章管理
jzd article list --postType article --status published
jzd article upload --title "标题" --content "内容" --publish

# 课程管理
jzd course list
jzd course create --title "课程名称" --price 0

# 应用市场
jzd marketplace stats                        # 市场统计
jzd marketplace list --type app              # 浏览应用
jzd marketplace create --name "应用" --type app --slug xxx --priceType free
jzd marketplace publish <uuid>               # 上架

# 反馈
jzd feedback submit --title "建议" --content "详情"

# 素材上传（图片/视频/文件）
jzd upload --check                                # 健康检查
jzd upload ./cover.png                            # 上传单张图片
jzd upload ./a.png ./b.png --type image           # 批量（自动去重）
jzd upload ./cover.png --json                     # JSON 输出（jq / 脚本拼装）
jzd upload ./a.png ./b.png --json-only            # 仅输出 URL 列表（每行一个）
```


## 📁 目录结构

```
.
├── bin/
│   └── jzd.mjs          CLI 主入口（自动加载 .env）
├── lib/
│   ├── client.mjs            API 客户端（HTTP 封装）
│   ├── articles.mjs          文章模块
│   ├── courses.mjs           课程模块
│   ├── marketplace.mjs       应用市场模块（列表/统计/上架/编辑）
│   ├── materials.mjs         素材库模块（upload 子命令底层封装）
│   ├── versions.mjs          产品版本发布模块（jzd version）
│   └── feedback.mjs          反馈模块
├── scripts/
│   ├── export-ddn-env.mjs    从 ClawDao 同步凭证到 .env（掩码输出）
│   └── publisher.mjs         markdown + 本地图片一键发布器（复用 MaterialManager）
├── .env                      API 凭证（已忽略入库）
└── .gitignore                密钥 / 依赖 / 日志忽略规则
```

## 🤝 与 ddn-hub-mcp 的关系

本项目是 `ddn-hub-mcp` 的**伴生 CLI 工具**：

- `ddn-hub-mcp` — MCP 协议服务器，供 AI Agent（如 Codex CLI）调用
- `jzd` — 命令行工具，供运营人员直接使用

两者共享相同的 API 客户端逻辑和接口定义。

## ⚖️ 许可

MIT
