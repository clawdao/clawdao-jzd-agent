# 应用市场上架规范（永久约束）

> ⚠️ **凡是通过 `jzd marketplace create` / `update` 上架或更新的应用，必须同时提供以下内容**：

## 一、必填字段

| 字段 | 用途 | 示例 |
|------|------|------|
| `--name` | 中文应用名 | `中医医案管理系统` |
| `--type` | 资产类型 | `app` / `skill` / `mcp` / `prompt` / `employee` / `plugin` / `template` |
| `--slug` | 唯一标识（与 GitHub repo 同名） | `clawdao-tcmc-system` |
| `--description` | 一句话简介 | `...` |
| `--tags` | 关键词（逗号分隔） | `中医,医案,OCR,统计` |
| `--category` | 类目 | `tools` / `content` / `media` |
| `--author` | 作者/组织 | `ClawDao Lab` |
| `--version` | 语义化版本 | `1.0.0` |
| `--sourceUrl` | 仓库地址 | `https://github.com/clawdao/<slug>` |

## 二、必带补充字段（README + License）

| 字段 | 说明 | 必填？ |
|------|------|--------|
| `--readme` | README.md 全文 markdown（推荐用 `@/path/to/README.md` 读取） | **必带** |
| `--license` | SPDX 协议标识 | **必带**（默认 `Apache-2.0`） |

### License 常用值（SPDX 格式）

| 值 | 协议 |
|----|------|
| `Apache-2.0` | Apache License 2.0（推荐开源项目） |
| `MIT` | MIT License |
| `AGPL-3.0` | GNU AGPL v3 |
| `GPL-3.0` | GNU GPL v3 |
| `BSD-3-Clause` | BSD 3-Clause |
| `Proprietary` | 专有 / 商业 |

## 三、标准操作流程

### 上架新应用（一行命令）

```bash
cd ~/Documents/projects/Agents/<中文项目目录>

# 1. 准备字段
NAME="应用中文名"
SLUG="clawdao-xxx-agent"
DESC="一句话描述"
VERSION="1.0.0"
SOURCE="https://github.com/clawdao/$(basename $SLUG)"

# 2. 确认私钥（README + 密钥安全）
grep -rE "AKLT[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}" . 2>/dev/null | grep -v node_modules

# 3. 同步凭证 + 创建 + 上架
cd ../觉知岛智能体
node bin/jzd.mjs marketplace create \
  --name "$NAME" \
  --type app \
  --slug "$SLUG" \
  --description "$DESC" \
  --category tools \
  --author "ClawDao Lab" \
  --version "$VERSION" \
  --sourceUrl "$SOURCE" \
  --priceType free \
  --tags "标签1,标签2" \
  --license "Apache-2.0" \
  --readme "@../<中文项目目录>/README.md"

# 4. 取 UUID 并上架
UUID=$(node bin/jzd.mjs marketplace list --admin 2>&1 | grep "$SLUG" | head -1 | awk '{print $1}')
node bin/jzd.mjs marketplace publish $UUID
```

### 更新已有应用（加 README + License）

```bash
node bin/jzd.mjs marketplace update <uuid> \
  --license "Apache-2.0" \
  --readme "@/path/to/README.md"
```

## 四、推送前必须做的检查

- [ ] README 与 GitHub 仓库 `README.md` 一致（不输出密钥）
- [ ] 仓库已创建且远程 URL 正确
- [ ] `git log` 无硬编码 token 字符串
- [ ] `.env` / `*.key` / `*.secret` 在 `.gitignore` 中
- [ ] 协议（License）与仓库实际 LICENSE 文件一致

## 五、强制规则

1. **不输出/不暴露密钥**：README 中禁止包含 API Key、Token、Password；如需引用环境变量，描述「设置 `XXX_TOKEN` 环境变量」即可。
2. **Slug 与 GitHub repo 一致**：便于后续 `git push` 和链接跳转。
3. **必带 License**：闭源项目可用 `Proprietary`。
4. **必带 README**：否则用户看到「资产但无文档」会困惑。
5. **每 1k star 的开源项目必设精选**：`node bin/jzd.mjs marketplace featured <uuid>`。

> 📝 本规范同样适用于 ddn-hub-mcp 的 `create_asset` 调用；CLI 只是其便捷封装。
