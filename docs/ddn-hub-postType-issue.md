# ddn-hub 发布文章 postType 字段问题 — 排查记录

## 问题现象
`POST https://ddn.net/api/v1/posts` 创建文章时，**所有合法 `postType` 值**（`news`、`article`、`help`、`idea`、`proposal`、`ledger`）都返回 500：

```json
{"status":1,"msg":"null value in column \"post_type\" of relation \"cms_posts\" violates not-null constraint"}
```

## 排查时间线

| 时间 | 探测 | 结果 |
|---|---|---|
| T1 | `POST /api/v1/posts` + `postType=news` | 500 (DB bug) |
| T2 | `POST /api/v1/posts` + 各种 postType 候选 | 全部 500 或 400 "不存在或未启用" |
| T3 | `POST /api/v1/cms/posts`（前端常量路径） | 404 Not Found |
| T4 | `POST /api/v1/admin/posts` | 404 Not Found |
| T5 | `GET /api/v1/health` | version=1.7.5, uptime=58h, env=prod |
| T6 | umi.js 反编译 | `/api/v1/cms/posts` 只是常量；`postType` 0 次出现（前端不传） |
| T7 | 完整字段组合 POST | 仍然 500 |
| T8 | 浏览器 headless 探测 | admin chunk 未加载（未登录），无法捕获真实 POST |

## 已知事实
1. **Server 端 `cms_posts.post_type` 列 NOT NULL**，但 egg-controller 写入 enum 值时丢失
2. **前端 `/user/tools/editor` 能成功发布**（用户亲测），但 SPA 真实 POST chunk 在登录后才 lazy load，未登录时无法捕获
3. **ddn-hub SPA 内部常量路径是 `/api/v1/cms/posts`**（不是 `/api/v1/posts`），但 cms/posts POST 当前 404

## 猜测的修复方向
- server 端升级后，`/api/v1/cms/posts` 应该是新创建端点；但当前 `cms/posts` POST 404
- 或者仍用 `/api/v1/posts`，但 server 端 enum → DB column 的 bug 没修

## 需要用户配合
1. **打开 Chrome DevTools → Network 面板**，在 editor 里创建一篇文章，复制 POST 请求的 URL/Headers/Body（包括响应 status code）
2. 或者提供**一个能直接 `POST /api/v1/cms/posts` 成功的 token / cookie**
3. 或者直接告诉我 ddn-hub 这次升级的具体 PR / commit 信息

## 当前 CLI 状态
✅ **server bug 已修复**（2026-09-19）：烟雾测试 `POST /api/v1/posts` 返回 201。

**事件**：v1.0.30 资讯文章实际发布成功
- 文章 id：**155**
- 标题：ClawDao v1.0.30 上线：协作更深、预览更顺手、安全更稳
- categoryId=12（龙虾岛更新日志），postType=news，status=published
- content length=4993

## 历史踩坑（已解决）
1. **`lib/articles.mjs` 默认把 `content` 设成 'placeholder'**（如果调用者只传 `contentMarkdown` 不传 `content`）。第一次发布 id=154 时，content length=44（占位符），内容丢失
   - **解决**：CLI `--content` 必须显式传 markdown 内容（`--content "$(cat file.md)"`）
2. **首次发布踩坑**：用 `--content-file outputs/.../article.md` 没被 CLI 解析，content 被当字符串字面 `outputs/.../article.md`
   - **教训**：CLI 当前版本只支持 `--content <str>`，文件需用 shell `$(cat ...)` 注入

## 建议改进（可作为下个版本功能）
- 给 `bin/jzd.mjs article upload` 加 `--content-file <path>` 选项（自动读取文件），避免 shell 长度限制和转义问题
- 给 `lib/articles.mjs.create()` 加自动 fallback：当 `contentMarkdown` 有但 `content` 没有时，把 `content` 设成 `md`（剥头后），避免占位符写入
