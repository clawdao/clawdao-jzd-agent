# 为 ddn-hub 添加 API ACCESS_TOKEN 功能的建议

## 问题

当前 ddn-hub 只支持用户登录后生成的 JWT session token，没有为外部工具（如 CLI 工具、MCP 服务、第三方集成）设计独立的 API 访问令牌机制。现有问题：

1. 用户登录 token 有效期短（7天），不适合自动化工具长期使用
2. 用户登录 token 权限过大（等同于用户全部权限），无法做细粒度授权
3. 没有吊销机制——一旦 token 泄露，只能等过期或改密钥
4. `appAuth.js` 从 `Authorization` 头中提取 token 但只验证了 JWT，没有区分是「用户会话 token」还是「API 访问令牌」

## 建议实现方案

### 1. 新增数据库模型 `SysApiAccessToken`

```sql
CREATE TABLE sys_api_access_tokens (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid        VARCHAR(36)  NOT NULL UNIQUE,
  user_id     BIGINT       NOT NULL,
  name        VARCHAR(100) NOT NULL COMMENT '令牌名称，方便管理',
  token_hash  VARCHAR(255) NOT NULL COMMENT '存储 token 的 bcrypt/sha256 哈希',
  token_prefix VARCHAR(8)  NOT NULL COMMENT '令牌前8位明文，用于列表展示和识别',
  scopes      JSON         COMMENT '权限范围，null 表示等同于用户权限',
  dao_id      BIGINT       COMMENT '绑定的 DAO ID，null 表示令牌可用于该用户所有 DAO',
  expires_at  DATETIME     COMMENT '过期时间，null 代表永不过期',
  last_used_at DATETIME,
  status      TINYINT      DEFAULT 1 COMMENT '1=活跃, 0=已吊销',
  created_at  DATETIME,
  updated_at  DATETIME,
  FOREIGN KEY (user_id) REFERENCES sys_users(id),
  INDEX idx_user_status (user_id, status),
  INDEX idx_token_prefix (token_prefix)
);
```

### 2. 认证中间件改造（关键）

`appAuth.js` 中增加 ACCESS_TOKEN 认证分支：

```javascript
// 在 performBasicAuth 中新增分支
async function performBasicAuth(ctx, config) {
  const token = extractToken(ctx);
  if (!token) return fail('缺少认证令牌');

  // 1. 先尝试作为 JWT session token 验证（现有逻辑）
  const user = await ctx.service.user.auth.verifyToken(token);
  if (user) {
    ctx.state.authMethod = 'session';
    return success(user);
  }

  // 2. 如果是 token 格式不符合 JWT（或 JWT 验证失败），尝试作为 API ACCESS_TOKEN 验证
  if (token.length >= 20) {
    const apiTokenUser = await verifyApiAccessToken(ctx, token);
    if (apiTokenUser) {
      ctx.state.authMethod = 'api_token';
      return success(apiTokenUser);
    }
  }

  return fail('令牌无效或已过期');
}
```

### 3. 令牌生成与管理的 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `POST /api/v1/user/api-tokens` | 创建令牌 | 参数：name, scopes?, dao_id?, expires_in_days? |
| `GET /api/v1/user/api-tokens` | 列出用户的令牌 | 返回名称、前缀、过期时间、最后使用时间，**不返回完整 token** |
| `DELETE /api/v1/user/api-tokens/:uuid` | 吊销令牌 | 软删除 |
| `POST /api/v1/user/api-tokens/:uuid/refresh` | 刷新令牌 | 延长过期时间 |

创建令牌的响应中应 **仅一次** 返回完整的 `access_token` 明文（如 `jzd_{prefix}_{random64}`），后续不再展示。

### 4. TOKEN 格式建议

格式：`jzd_{可读前缀8位}_{随机64字符}`

示例：`jzd_aB3kXm9p_7f8a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0`

- 前缀用于管理端列表展示（用户可识别是哪个令牌）
- 完整 token 存入数据库时做 SHA256 哈希，不存明文

### 5. jzd-ops 客户端对应改造

`client.mjs` 中的 `buildHeaders` 已经支持 `Authorization: Bearer` 头，使用方只需：

```bash
# 现有的 DDN_HUB_AUTH_TOKEN 直接作为 ACCESS_TOKEN 使用
export DDN_HUB_AUTH_TOKEN=jzd_aB3kXm9p_7f8a3b2c...
```

## 预期收益

- ✅ 外部工具（jzd-ops、ddn-hub-mcp）可以获取长期有效的令牌，无需频繁登录
- ✅ 可以按 DAO 或 scope 限制令牌权限
- ✅ token 泄露后可独立吊销，不影响用户密码/登录
- ✅ 审计日志中可区分「API 调用」与「用户页面操作」

## 参考实现（Egg.js 示例）

```javascript
// app/controller/user/apiToken.js
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

async function create(ctx) {
  const { name, scopes, daoId, expiresInDays } = ctx.request.body;
  const userId = ctx.state.user.id;

  const prefix = crypto.randomBytes(4).toString('base64url');
  const secret = crypto.randomBytes(48).toString('hex');
  const rawToken = `jzd_${prefix}_${secret}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await ctx.model.SysApiAccessToken.create({
    uuid: uuidv4(),
    userId,
    name,
    tokenHash,
    tokenPrefix: prefix,
    scopes: scopes || null,
    daoId: daoId || null,
    expiresAt: expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null,
  });

  ctx.body = {
    status: 0,
    msg: '令牌创建成功（请妥善保管，仅展示一次）',
    data: {
      uuid: record.uuid,
      name: record.name,
      access_token: rawToken,  // ⚠️ 仅此一次返回明文
      tokenPrefix: prefix,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    },
  };
}

async function verify(ctx, token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await ctx.model.SysApiAccessToken.findOne({
    where: { tokenHash: hash, status: 1 },
    include: [{ model: ctx.model.SysUser, as: 'user' }],
  });

  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) {
    record.update({ status: 0 }); // 自动吊销过期令牌
    return null;
  }

  await record.update({ lastUsedAt: new Date() });
  return record.user;
}
```
