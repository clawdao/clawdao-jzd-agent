# v1.0.30 资讯文章 — 图片 URL 映射（已发布到觉知岛）

发布平台：觉知岛（DDN Hub）
文章 ID：155
发布 DAO：42c7218b-c10e-4edd-a38c-0c5022dfc982（AI 深度学堂）
postType：news / categoryId：12（龙虾岛更新日志）
最后更新：2026-09-19

## 图片 URL

| 原文件 | 觉知岛 URL |
| --- | --- |
| `images/cover-arch.png` | https://s3.ddn.net/ddn-hub/uploads/42c7218b-c10e-4edd-a38c-0c5022dfc982/image/20260919/ccd46a7cb1ae476da9093957632b926c.png |
| `images/ui-preview.png` | https://s3.ddn.net/ddn-hub/uploads/42c7218b-c10e-4edd-a38c-0c5022dfc982/image/20260919/366c277d85564918ad7ff73ca3951fc2.png |
| `images/logo.png` | https://s3.ddn.net/ddn-hub/uploads/42c7218b-c10e-4edd-a38c-0c5022dfc982/image/20260919/f22e80bc56874ec4930105caf56bc76e.png |

## 操作日志

- 2026-09-19 21:01 — 通过 `jzd upload --type image` 上传 3 张图片到觉知岛素材库
- 2026-09-19 21:02 — 用 `lib/articles.mjs.update(155, {contentMarkdown})` PUT 更新觉知岛文章
- 2026-09-19 21:02 — 验证：远程图片数=3，剩余相对路径数=0

## 复现

```bash
# 1. 上传图片
node bin/jzd.mjs upload outputs/v1.0.30-news/images/*.png --type image --json

# 2. 把 ./images/xxx.png 替换为远程 URL（在 article.md 内手动或 sed）

# 3. PUT 更新觉知岛文章
node bin/jzd.mjs article upload \
  --title "ClawDao v1.0.30 上线：协作更深、预览更顺手、安全更稳" \
  --content-file outputs/v1.0.30-news/article.md \
  --postType news --category-id 12 \
  --description "..." \
  --extra-data '{"category":"资讯","subcategory":"龙虾岛更新日志","product":"ClawDao","version":"1.0.30"}' \
  --publish
```

（首次创建用 upload；更新已有文章用 lib/articles.mjs.update(id, {contentMarkdown})）