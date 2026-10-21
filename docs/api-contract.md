# API 契约（冻结 · v1.0）

> 状态：**已冻结**。前端可据此起 mock 并联调。
> 代码参考（可执行形态）：`backend/src/contract/schemas.ts`
> 本文档与 `schemas.ts` 是同一契约的两种载体，任何改动都是契约变更，需在 ALICE-6 说明。

## 1. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `/api/v1` |
| 数据格式 | JSON（请求 `Content-Type: application/json`） |
| 时间 | ISO-8601（`2026-10-21T11:00:00.000Z`） |
| 认证 | 写接口（`/admin/*`）需 `Authorization: Bearer <token>`（阶段 2.1 实现登录后签发）；读接口（前台）公开 |
| 分页 | offset 分页：`page`（≥1，默认 1）、`pageSize`（1..100，默认 20）；MVP 数据量小，offset 足够，P2 换游标 |
| 幂等 | 笔记为 1:1，`PUT /admin/projects/:id/note` 幂等 upsert |

### 1.1 成功响应信封

- 单对象 / 详情：直接返回资源对象
- 列表：返回分页信封

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```

### 1.2 错误响应信封（冻结）

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [{ "field": "name", "code": "required", "message": "项目名称必填" }],
    "requestId": "req_..."
  }
}
```

### 1.3 错误码与 HTTP 状态（冻结）

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 字段校验失败（`details` 给字段级错误） |
| 400 | `INVALID_STATUS_TRANSITION` | 状态机非法迁移（如 draft→archived 跨级） |
| 401 | `UNAUTHORIZED` | 未登录 / token 缺失、无效、过期 |
| 403 | `FORBIDDEN` | 已登录但无权限 |
| 404 | `NOT_FOUND` | 资源不存在，或对当前调用者不可见 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不允许 |
| 409 | `CONFLICT` | 唯一约束冲突（如重复技术栈名） |
| 500 | `INTERNAL_ERROR` | 服务端未预期错误（不含堆栈） |

## 2. 资源与字段

### 2.1 枚举（冻结值）

| 字段 | 值 |
|---|---|
| `status`（发布状态） | `draft` · `published` · `archived` |
| `projectStatus`（项目状态） | `active` · `completed` · `maintained` · `paused` |
| `link.type` | `repo` · `website` · `demo` · `other` |

### 2.2 Project

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 输出 | cuid |
| name | string | 是 | 1..100 |
| tagline | string\|null | 否 | ≤200，一句话简介 |
| description | string\|null | 否 | ≤100000，Markdown |
| coverImage | string\|null | 否 | 封面图 URL，http/https ≤2048；后台创建/PATCH 可写，前台列表/详情公开返回；null 用渐层兜底 |
| status | enum | 否 | 默认 `draft` |
| stars | int\|null | 否 | ≥0，后台手填（P0） |
| lastActivityAt | ISO8601\|null | 否 | 项目更新时间，后台手填（P0） |
| role | string\|null | 否 | 元数据·角色 ≤100 |
| projectStatus | enum\|null | 否 | 元数据·项目状态 |
| startDate / endDate | ISO8601\|null | 否 | 元数据·时间范围 |
| githubRepo | string\|null | 否 | 预留·`owner/repo`（P1 自动拉取） |
| technologies | string[] | 否 | 技术栈名列表，≤50 |
| createdAt / updatedAt | ISO8601 | 输出 | 记录自身时间 |
| deletedAt | ISO8601\|null | 输出（仅后台） | 软删除标记；仅 `/admin/*` 响应返回，前台不可见 |

> GitHub 自动拉取预留字段（`githubStars` / `githubLastActivityAt` / `githubSyncedAt`）**不进入 API 契约**，仅存库，P1 实现同步时再冻结对外字段。

### 2.3 Link

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 输出 | cuid |
| type | enum | 否 | 默认 `other` |
| label | string\|null | 否 | ≤100，显示名 |
| url | string | 是 | 合法 http/https，≤2048 |
| sortOrder | int | 否 | ≥0，越小越靠前 |
| createdAt | ISO8601 | 输出 | |

### 2.4 Note（1:1 项目）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 输出 | cuid |
| title | string | 是 | 1..200 |
| content | string | 是 | 1..100000，纯 Markdown |
| createdAt / updatedAt | ISO8601 | 输出 | |

## 3. 路由表（冻结）

### 3.0 认证（公开，签发 token）

| Method | Path | 说明 |
|---|---|---|
| POST | `/auth/login` | 登录，校验 `{username, password}`，返回 `{token, expiresAt}` |

- 身份模型：**单管理员，不建 user 表**（出现第二个管理员需求时重议）。登录端点置于 Bearer 守卫之外。
- 凭据走环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `AUTH_SECRET`；`ADMIN_PASSWORD_HASH` 为 scrypt(N=16384,r=8,p=1,keylen=64) 哈希，格式 `scrypt$<saltHex>$<hashHex>`，用 `node scripts/hash-password.mjs <明文>` 生成。
- token 为 JWT HS256（HMAC-SHA256 签名），payload `sub="admin"`、`iat`/`exp`（秒）；TTL 由 `AUTH_TTL_SECONDS` 控制，默认 7 天（604800）。
- 错误口令统一返回 `401 UNAUTHORIZED`（不区分用户名/口令错误）。

### 3.1 前台（公开）

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/projects` | 已发布项目列表（`status=published` 且未软删除） |
| GET | `/projects/:id` | 已发布项目详情（含元数据 + 链接 + 笔记） |
| GET | `/technologies` | 技术栈标签列表（筛选下拉用） |

`GET /projects` 查询参数：`search`（名称/简介模糊）、`technology`（技术栈名精确）、`page`、`pageSize`——已冻结进 `schemas.ts` 的 `PublicProjectListQuerySchema`。默认排序 `lastActivityAt desc`（为空回退 `updatedAt`）。

### 3.2 后台（Bearer）

| Method | Path | 说明 |
|---|---|---|
| GET | `/admin/projects` | 全部项目（含草稿/下架），`includeDeleted=true` 含已删除，`status`/`search`/`page`/`pageSize` 过滤 |
| POST | `/admin/projects` | 创建项目（`technologies` 按名 upsert） |
| GET | `/admin/projects/:id` | 详情（任意状态） |
| PATCH | `/admin/projects/:id` | 更新（含发布/下架：`status` 字段） |
| DELETE | `/admin/projects/:id` | 软删除（置 `deletedAt`，可恢复） |
| POST | `/admin/projects/:id/restore` | 恢复软删除 |
| PUT | `/admin/projects/:id/note` | 创建/替换项目笔记（1:1 幂等） |
| DELETE | `/admin/projects/:id/note` | 删除笔记 |
| POST | `/admin/projects/:id/links` | 添加链接 |
| PATCH | `/admin/links/:id` | 更新链接 |
| DELETE | `/admin/links/:id` | 删除链接 |

> **PATCH 语义（冻结）**：未传字段忽略；显式 `null` 清空 nullable 字段；`technologies` 传数组即整体替换（含 `[]` 清空）。
>
> **状态机（冻结，见 3.3）**：`status` 仅允许 draft→published、published→archived、archived→published；其余（跨级 draft↔archived、published→draft 回退）返回 `400 INVALID_STATUS_TRANSITION`；相同状态 no-op。
>
> **默认排序（冻结）**：后台 `GET /admin/projects` 默认 `updatedAt desc`；过滤参数（`status`/`search`/`includeDeleted`/分页）已冻结进 `schemas.ts` 的 `AdminProjectListQuerySchema`。

### 3.3 发布/下架状态机（冻结）

| from \ to | draft | published | archived |
|---|---|---|---|
| draft | no-op | ✅ 发布 | ❌ 400（跨级） |
| published | ❌ 400（无回退草稿） | no-op | ✅ 下架/归档 |
| archived | ❌ 400（跨级） | ✅ 重新上架 | no-op |

（任意状态）→ [软删除] `deletedAt` 置值 → [恢复] `deletedAt` 置空。

非法迁移返回 `400 INVALID_STATUS_TRANSITION`；相同状态为 no-op（不报错）。前台只可见 `status=published 且 deletedAt 为空` 的项目。

## 4. 示例

### 4.1 登录

```
POST /api/v1/auth/login
{ "username": "admin", "password": "******" }
```

```json
{ "token": "<signed-token>", "expiresAt": "2026-10-28T00:00:00.000Z" }
```

### 4.2 前台列表

```
GET /api/v1/projects?technology=Vue&page=1&pageSize=20
```

```json
{
  "items": [
    {
      "id": "c...",
      "name": "multica-demo",
      "tagline": "项目展示平台",
      "status": "published",
      "stars": 12,
      "lastActivityAt": "2026-10-20T00:00:00.000Z",
      "technologies": ["Vue", "Node.js"],
      "createdAt": "2026-10-21T00:00:00.000Z",
      "updatedAt": "2026-10-21T00:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "totalPages": 1
}
```

### 4.3 前台详情

`GET /api/v1/projects/:id` → 列表字段 + `description`/`role`/`projectStatus`/`startDate`/`endDate`/`githubRepo`/`links[]`/`note`。

### 4.4 创建项目

```
POST /api/v1/admin/projects
{ "name": "multica-demo", "tagline": "项目展示平台", "technologies": ["Vue", "Node.js"] }
```

`201` 返回完整 Project；校验失败 `400 VALIDATION_ERROR`。

## 5. 已知限制（P2，MVP 可接受，记录在案）

1. `technology.name` 唯一为**大小写敏感**（SQLite）；upsert 前已 `trim`，但 `vue`/`Vue` 仍会成两条（大小写归一策略未定）。
2. `technologies` 数组顺序无保证（`project_technology` 无 position/sortOrder）；如需固定展示顺序需加列。
3. `GET /technologies` 返回 `{items: string[]}`（仅名称，排序未定义）；前端下拉如需稳定顺序需另议。
4. 空值约定：`note`/`links` 为空时详情返回 `null`/`[]`；`GET /admin/projects/:id` 含已软删除项（配合 `deletedAt` 非空判断）。
5. 命名可读性：`status`（发布态）与 `projectStatus`（项目态）易混，前端 `types/` 建议用别名（如 `publishStatus`）强区分。

> 上述限制不阻塞阶段 2/3，触发实际需求时再议。
