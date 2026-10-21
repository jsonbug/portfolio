# API 契约（冻结 · v1.2）

> 状态：**已冻结**（ALICE-7 阶段 1 数据层交付）。口径来源：《开发计划 v1.2》第五节数据模型与路由表。
> 代码参考（可执行形态）：`backend/src/contract/schemas.ts`；本文档与 `schemas.ts` 是同一契约的两种载体，
> 任何改动都是契约变更，需在 issue 中说明。
>
> v1.2 相对 v1.0 的**破坏性变更**（前端需按本文件改造）：
> 1. 字段命名统一为第五节 snake_case（`publish_status` / `progress` / `slug` / `cover_image_url` / `summary` …）；
> 2. 曝光状态 `publish_status` 与进展 `progress` 拆成两个正交字段（原单字段 `status` 取消）；
> 3. 项目 / 笔记以 `slug` 定位，改名后旧地址 301；
> 4. 笔记由 1:1 改为 N:1（一个项目多篇笔记），新增独立笔记栏目 `/notes`；
> 5. 链接类型 `website` → `site`，新增 `docs`；技术栈不再是独立资源，为项目的字符串数组。

## 1. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `/api/v1` |
| 数据格式 | JSON（请求 `Content-Type: application/json`） |
| 时间 | ISO-8601（`2026-10-21T11:00:00.000Z`），库内存 unix ms |
| 认证 | 写接口 `/api/v1/admin/**` 需 `Authorization: Bearer <token>`；前台读接口公开 |
| 分页 | offset 分页：`page`（≥1，默认 1）、`pageSize`（1..100，默认 20） |
| PATCH 语义 | 未传字段忽略；显式 `null` 清空 nullable 字段；数组字段传值即整体替换（`[]` 清空） |

### 1.1 成功响应信封

- 单对象 / 详情：直接返回资源对象
- 列表：分页信封（前台项目列表额外带 `counts`，见 3.1）

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```

### 1.2 错误响应信封（冻结）

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [{ "field": "slug", "code": "invalid_string", "message": "slug 只能包含小写字母、数字与连字符，长度 2–64" }],
    "requestId": "req_..."
  }
}
```

### 1.3 错误码与 HTTP 状态（冻结）

| code | HTTP | 触发场景 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 请求体/查询参数校验失败（含 slug 格式、summary 超 60 字、元数据键名重复） |
| `UNAUTHORIZED` | 401 | 缺少/无效 Bearer token |
| `FORBIDDEN` | 403 | 已认证但无权操作（当前无多角色，保留） |
| `NOT_FOUND` | 404 | 资源不存在；**草稿/归档/软删除项目对前台一律 404，不泄露存在性** |
| `CONFLICT` | 409 | 唯一键冲突（slug 被占用） |
| `INVALID_STATUS_TRANSITION` | 400 | 曝光状态迁移不合法（如 `draft` → `archived`） |
| `METHOD_NOT_ALLOWED` | 405 | 方法不支持 |
| `INTERNAL_ERROR` | 500 | 未预期错误（日志含 requestId，响应不回传堆栈） |

## 2. 枚举（冻结）

| 枚举 | 取值 | 说明 |
|---|---|---|
| `publish_status` | `draft` \| `published` \| `archived` | 曝光维度，决定前台可见性 |
| `progress` | `ongoing` \| `launched` | 内容维度进展，与曝光正交；前台分段只有「全部 / 进行中 / 已上线」 |
| `note.publish_status` | `draft` \| `published` | 笔记发布状态 |
| `link.type` | `repo` \| `site` \| `docs` \| `demo` \| `other` | v1.2 把 `website` 改名为 `site` |
| `slug` | `^[a-z0-9-]{2,64}$` | 项目与笔记**各自命名空间**内唯一；两者可同名 |

### 2.1 曝光状态机

```
draft ──publish──▶ published ──archive──▶ archived
  ▲                    │                     │
  └────withdraw────────┘                     │
  ◀──────────────────publish─────────────────┘
```

| from → to | 结果 |
|---|---|
| `draft` → `published` | 200，首次发布写入 `published_at` |
| `published` → `archived` | 200 |
| `published` → `draft`（撤回） | 200（v1.2 允许；v1.0 曾返回 400） |
| `archived` → `published` | 200，`published_at` 保留首次发布时间 |
| 其余（`draft` ↔ `archived` 跨级） | 400 `INVALID_STATUS_TRANSITION` |
| 相同状态重复提交 | 200 no-op |

### 2.2 可见性判定（唯一口径）

- 前台项目可见 = `publish_status = 'published'` **且** `deleted_at IS NULL`
- 前台笔记可见 = `notes.publish_status = 'published'` **且** 所属项目前台可见
- 归档项目：前台列表/详情/笔记**全部不可见**，也不参与 `counts` 分段统计；后台仍可见可改
- 软删除项目：后台默认列表隐藏（`includeDeleted=true` 可见），前台 404，可 restore

## 3. 前台接口（公开）

### 3.1 `GET /projects` — 项目列表

查询参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `search` | string | 匹配 `name` / `summary`（子串，大小写不敏感由 SQLite LIKE 决定） |
| `technology` | string[] | 技术栈名多选，**任一命中**；支持 `?technology=Vue&technology=Node` 或 `?technology=Vue,Node` |
| `progress` | `ongoing` \| `launched` | 进展分段；不传 = 全部 |
| `sort` | `recent`（默认）\| `stars` | `recent` 用 `last_updated_at`，为空回退系统 `updated_at` |
| `page` / `pageSize` | int | 见通用约定 |

响应（`items[]` 为 `ProjectListItem`）：

```json
{
  "items": [
    {
      "id": "ckxyz",
      "slug": "portfolio-platform",
      "name": "项目展示平台",
      "summary": "把做过的项目收拢成一页一页的东西",
      "cover_image_url": "https://cdn.example.com/cover.webp",
      "progress": "ongoing",
      "stars": 42,
      "version": "1.2.0",
      "last_updated_at": "2026-10-01T00:00:00.000Z",
      "tech_stack": ["TypeScript", "Fastify", "Prisma"],
      "links": [
        {
          "id": "l1",
          "type": "repo",
          "label": "GitHub",
          "url": "https://github.com/jsonbug/portfolio",
          "sort": 0,
          "last_status": null,
          "last_http_status": null,
          "last_checked_at": null,
          "created_at": "2026-09-01T00:00:00.000Z"
        }
      ],
      "created_at": "2026-09-01T00:00:00.000Z",
      "updated_at": "2026-10-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "totalPages": 1,
  "counts": { "all": 1, "ongoing": 1, "launched": 0 }
}
```

`counts`（v1.2 新增，F6 分段数字用）：按「search + technology」过滤后、`progress` 过滤前的可见项目集合统计；
前台没有归档分段，`all / ongoing / launched` 三项之和 = `counts.all`。

公开列表项**不含** `publish_status` / `published_at` / `deleted_at` / `cover_source_url`。

### 3.2 `GET /projects/:slug` — 项目详情

在 `ProjectListItem` 基础上增加：

```json
{
  "description_md": "# 项目说明",
  "role": "全栈",
  "license": "MIT",
  "start_year": 2023,
  "team_size": 3,
  "metadata": [{ "key_label": "代码行数", "value": "12k", "sort": 0 }],
  "notes": [
    {
      "id": "n1", "slug": "note-1", "title": "复盘",
      "project": { "slug": "portfolio-platform", "name": "项目展示平台" },
      "tags": ["复盘"], "published_at": "2026-09-10T00:00:00.000Z",
      "created_at": "2026-09-09T00:00:00.000Z", "updated_at": "2026-09-10T00:00:00.000Z"
    }
  ]
}
```

- 固定元数据列（`role` / `license` / `start_year` / `team_size`）为 `null` 时前端整行不渲染
- `metadata` 为自定义 KV，按 `sort` 升序；`notes` 只含已发布笔记，按发布时间倒序
- **旧 slug**（改名过）：`301 Moved Permanently`，`Location: /api/v1/projects/<new-slug>`；目标不可见时 404

### 3.3 `GET /notes` — 笔记列表

| 参数 | 说明 |
|---|---|
| `search` | 匹配 `title` / `body_md` |
| `tag` | 标签精确匹配 |
| `page` / `pageSize` | 分页 |

`items[]` 为 `NoteSummary`（同上 `notes` 元素结构），按 `published_at` 倒序。

### 3.4 `GET /notes/:slug` — 笔记详情

`NoteSummary` + `body_md`；旧 slug 301；草稿或所属项目不可见 → 404。

### 3.5 `GET /technologies` — 技术栈标签

```json
{ "items": ["Fastify", "Prisma", "TypeScript"] }
```

只汇总**前台可见项目**的技术栈名（去重升序），前台筛选下拉与后台编辑器共用。

### 3.6 `GET /health`

```json
{ "status": "ok", "uptime": 12.3 }
```

## 4. 后台接口（`/api/v1/admin/**`，需 Bearer）

### 4.1 项目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/projects` | 列表；`publish_status` / `progress` / `search`（name、summary、slug）/ `includeDeleted`（`true`/`1`）过滤；按 `updated_at` 倒序 |
| GET | `/admin/projects/:id` | 详情，含**全部**笔记（含草稿）+ `publish_status` / `published_at` / `deleted_at` / `cover_source_url` |
| POST | `/admin/projects` | 新建，默认 `publish_status=draft`、`progress=ongoing`；201 |
| PATCH | `/admin/projects/:id` | 局部更新；slug 改名规则见下；状态机见 2.1 |
| DELETE | `/admin/projects/:id` | 软删除（写 `deleted_at`），幂等，返回详情 |
| POST | `/admin/projects/:id/restore` | 取消软删除 |
| PUT | `/admin/projects/:id/metadata` | 整体替换自定义 KV（数组，≤50 条，键名不得重复），返回项目详情 |

`POST` / `PATCH` 请求体（`ProjectUpsert`）：

| 字段 | 类型 | 规则 |
|---|---|---|
| `slug` | string | 必填（POST）；`^[a-z0-9-]{2,64}$`；被占用 → 409 |
| `name` | string | 必填，≤100 |
| `summary` | string \| null | ≤60 字（超出 400） |
| `description_md` | string \| null | ≤100k |
| `cover_image_url` / `cover_source_url` | string \| null | http/https only |
| `publish_status` | enum | 见 2.1 |
| `progress` | enum | `ongoing` / `launched` |
| `stars` / `version` | int \| null / string \| null | ≥0 / ≤50 |
| `last_updated_at` | ISO \| null | 「最近更新」展示用 |
| `role` / `license` | string \| null | ≤100 |
| `start_year` | int \| null | 1000..9999 |
| `team_size` | int \| null | 1..100000 |
| `tech_stack` | string[] | 每个 ≤50；写入时去重、顺序即 `sort`；传数组整体替换 |

**slug 改名规则（B15）**：项目发布过（`published_at` 非空）→ 旧 slug 记入 `slug_aliases`，旧地址 301；
从未发布的草稿改名不留历史。

**链接**（独立端点，`sort` 缺省追加到末尾；健康检查字段只读）：

| 方法 | 路径 |
|---|---|
| POST | `/admin/projects/:id/links` → 201 |
| PATCH | `/admin/links/:id` |
| DELETE | `/admin/links/:id` → 204 |

### 4.2 笔记

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/notes` | 列表；`project_id` / `publish_status` / `search` 过滤；按 `updated_at` 倒序；**不含 `body_md`** |
| POST | `/admin/notes` | 新建，`project_id` 必填（项目不存在 → 404）；201 |
| GET | `/admin/notes/:id` | 详情，含 `body_md` |
| PATCH | `/admin/notes/:id` | 局部更新；`tags` 整体替换；`publish_status` 变更维护 `published_at`；slug 改名规则同项目 |
| DELETE | `/admin/notes/:id` | 硬删除，204 |

`NoteCreate` / `NoteUpdate`：`slug`（`^[a-z0-9-]{2,64}$`，note 命名空间唯一）、`title`（≤200）、
`body_md`（1..100k）、`publish_status`、`tags`（≤20 个，每个 ≤50）。

### 4.3 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ token, expiresAt }`；失败 401 |

> 阶段 1 说明：登录仍读环境变量（`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`）；`admin_users` 表已随迁移建好，
> 改为库内账号（D1 密码登录）在阶段 2.1 落地。

## 5. 变更记录

| 版本 | 变更 |
|---|---|
| v1.0 | ALICE-6 MVP 冻结（单字段 `status`、笔记 1:1、`website` 链接类型、camelCase 字段） |
| v1.2 | 本文件：第五节口径落地，`publish_status`/`progress` 双字段、slug 定位 + 301、笔记 N:1、元数据固定列 + KV、链接枚举调整、`counts` 分段统计 |
