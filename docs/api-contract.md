# API 契约（冻结 · v1.2）

> 状态：**已冻结**（ALICE-7 阶段 1 数据层交付；ALICE-8 冻结核对补 v1.2.1；v1.2.2 补链接健康检查 §4.4 与两套 counts 对称口径；v1.2.3 补分页越界、`details[].code`、`NoteSummary.excerpt` 三处条文，见 1.4；v1.2.4 把信封层 `error.code` 值域归位到 1.3 并校正 1.4 第 2 条的 `code` 来源措辞；v1.2.5 按 compose 冒烟实测补 4.1 的子资源条文；v1.2.6 补项目截图与元数据 `kind` 条文，见 4.1.1；v1.2.7 把 `METHOD_NOT_ALLOWED` 标为保留值并冻结「未知方法 404」、明确 `details[].code` 结构必带）。口径来源：《开发计划 v1.2》第五节数据模型与路由表。
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
| 分页 | offset 分页：`page`（≥1，默认 1）、`pageSize`（1..100，默认 20）；越界返回空页而非报错，口径见 1.4 |
| PATCH 语义 | 未传字段忽略；显式 `null` 清空 nullable 字段；数组字段传值即整体替换（`[]` 清空） |
| 字段命名 | **wire 上一律 `snake_case`**（与第五节表结构同名）；前端不做 camelCase 映射 |
| Markdown | 后端只存原文（`description_md` / `body_md`），**不做 HTML 净化**；渲染侧（前端 DOMPurify，禁 raw HTML）负责 XSS 过滤（N2） |

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

> `details[].code` 的来源、结构必带与「可展示不可分支」口径见 1.4 第 2 条；**信封层 `error.code` 相反，是客户端唯一允许分支的字段，值域以 1.3 为唯一出处**。

**信封层 `error.code` 值域（v1.2.4 冻结）**

- 取值只能是 **1.3 表里的 8 个之一**。本节不重复枚举，**1.3 是值域的唯一出处**；新增或删除任何 code 都是契约变更。
- 客户端**只允许**对 `error.code` 分支；出现值域外的 `code` 视为契约违约，客户端按通用错误处理、只展示 `message`，不得静默当作成功。
- `code` 与 HTTP 状态必须符合 1.3 的映射；两者不一致时**以 `code` 为准**（例：同样是 400，客户端要靠 `code` 区分 `VALIDATION_ERROR` 与 `INVALID_STATUS_TRANSITION`）。

### 1.3 错误码与 HTTP 状态（冻结）

本节是**信封层 `error.code` 值域的唯一出处**（v1.2.4 明确）：**8 个取值全部冻结**，实现侧对应 `backend/src/lib/errors.ts` 的 `ErrorCode` 联合类型与 `errorStatusMap`，两处一致才视为契约未漂。

> 实现现状：`FORBIDDEN` 与 `METHOD_NOT_ALLOWED` 都是**保留值、当前实现不产生**。`FORBIDDEN`：单管理员模型无多角色。`METHOD_NOT_ALLOWED`（v1.2.7 定论）：**不开启框架 405**——未知方法实测返回 **404 `NOT_FOUND`**（`PUT /api/v1/projects` 实测），理由是让每个路径枚举方法会把暴露维度从「路径存在与否」扩到「路径存在但方法不对」，而客户端拿到的信息量提升近零。两者映射的 HTTP 状态仍保留在 `errorStatusMap` 里，但**业务与框架均不生产**；将来若产生，属契约变更。

**冻结行为**：未知方法 → 404 `NOT_FOUND`（不是 405），由 `backend/src/routes/` 侧测试钉住，谁「顺手开启 405」会直接变红。

| code | HTTP | 触发场景 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 请求体/查询参数校验失败（含 slug 格式、summary 超 60 字、元数据键名重复） |
| `UNAUTHORIZED` | 401 | 缺少/无效 Bearer token |
| `FORBIDDEN` | 403 | 已认证但无权操作（当前无多角色，保留） |
| `NOT_FOUND` | 404 | 资源不存在；**草稿/归档/软删除项目对前台一律 404，不泄露存在性** |
| `CONFLICT` | 409 | 唯一键冲突（slug 被占用） |
| `INVALID_STATUS_TRANSITION` | 400 | 曝光状态迁移不合法（如 `draft` → `archived`） |
| `METHOD_NOT_ALLOWED` | 405 | **保留值，当前实现不产生**：未知方法实测 404 `NOT_FOUND`（见上） |
| `INTERNAL_ERROR` | 500 | 未预期错误（日志含 requestId，响应不回传堆栈） |

### 1.4 分页越界、错误体细节与摘要字段（v1.2.3 冻结）

本节三条此前只有实现、没有条文，是前后端各自写一套期望值的根因。自 v1.2.3 起以本条文为唯一口径，实现与契约测试（`frontend/test/contract/`）均以此为准。

**1. 分页：越界不是错误**

- `page` / `pageSize` 非数字、`page < 1`、`pageSize ∉ [1, 100]` → **400** `VALIDATION_ERROR`（`details[].field` 指向出错参数）。
- `page > totalPages` → **200**，`items: []`，`total` 与 `totalPages` 为真值（不得归零，也不返回 404）。

```json
{ "items": [], "page": 9, "pageSize": 20, "total": 3, "totalPages": 1 }
```

判定顺序：**先校验格式与范围（400），再执行查询、判定是否越界（200 空页）**。
两条规则适用于**全部列表端点**（`/projects`、`/notes`、`/admin/projects`、`/admin/notes`），不因端点而异。

**2. `details[]`：结构必带，`code` 值不承诺稳定**

- `details[]` 结构 **必带三个键**（`field` / `code` / `message`）：**任何一侧都不得省掉 `code`**（包括 mock）——结构偏离契约的代价高于「有人可能按 `code` 分支」（v1.2.7 明确：mock 保留 `code`，靠评审与本节守「不得分支」，不靠删数据）。
- `code` 的来源有两类：**zod issue code**（如 `too_big` / `invalid_type`）与**非 zod 路径手写的实现标识**（如 409 的 `conflict`、400 的 `invalid_transition`）。两类都**不承诺稳定**。
- 客户端的边界是**可展示、不可分支**：允许把 `details[].code` 原文展示出来（排查用），**不得**对它取等分支；也不得把「`code` 等于某个具体值」写进 mock、测试断言或组件分支（`$ grep` 可验）。
- 因此不得把「`code` 透传 zod issue code」当成实现义务（v1.2.4 校正：原措辞与实现不符，409/状态迁移两处详情是手写标识，见 `backend/src/routes/admin/projects.ts` 与 `admin/notes.ts`）。
- 客户端只允许依赖封套的 `error.code`（见 1.3）判类型；`details[].message` 仅用于直接展示，不参与任何分支判断。
- 可验证：契约测试比对两侧错误体的 **`Object.keys(details[0]).sort()`**，mock 与真实后端的键集合必须相同（这是「错误体同构」的证据）。

**3. `excerpt`：`NoteSummary` 必带字段**

- 定义：`body_md` **去 Markdown 后取前 120 字，超长加省略号，空正文为 `null`**。
- `NoteSummary` **必带此字段**：`GET /notes` 的 `items[]`、`GET /projects/:slug` 的 `notes[]`、后台笔记列表、后台项目详情的 `notes[]` 一律带。
- 可验证：取值只允许 `null` 或长度 ≤ 121 的字符串（120 字 + 单字符省略号 `…`），且不含 Markdown 记号（`#` / `**` / 反引号 / 链接语法）。
- `GET /notes/:slug`（3.4）返回 `NoteSummary` + `body_md`，**同样必带 `excerpt`**（正文已给全文，但字段不允许缺省）。

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
| `sort` | `recent`（默认）\| `stars` | `recent` 用 `last_updated_at`，为空回退系统 `updated_at`；`stars` 降序、`stars` 为 null 的排最后，同分再按 `recent` 兜底 |
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
          "last_status": "unknown",
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

> **两套 `counts` 口径对称（冻结）**：前台的 `counts` 按 `progress` 分段，后台的 `counts` 按 `publish_status` 分段
> （见 4.1），两者都是「按 `search` 等搜索条件过滤后、按分段条件过滤前」的集合统计，
> **都不是全站总数**（前台不含草稿/归档/软删，后台含草稿但受 `includeDeleted` 影响）。

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
  "metadata": [
    { "key_label": "代码行数", "value": "12k", "sort": 0, "kind": "meta" },
    { "key_label": "gzip 包体", "value": "48KB", "sort": 1, "kind": "metric" }
  ],
  "screenshots": [
    { "id": "s1", "url": "https://cdn.example.com/waveform-1.webp",
      "caption": "Waveform Studio — 编辑器中的波形轨道（v2.4）", "sort": 0 }
  ],
  "notes": [
    {
      "id": "n1", "slug": "note-1", "title": "复盘",
      "project": { "slug": "portfolio-platform", "name": "项目展示平台" },
      "excerpt": "这次把列表重写成 URL 查询为唯一真源…",
      "tags": ["复盘"], "published_at": "2026-09-10T00:00:00.000Z",
      "created_at": "2026-09-09T00:00:00.000Z", "updated_at": "2026-09-10T00:00:00.000Z"
    }
  ]
}
```

- 固定元数据列（`role` / `license` / `start_year` / `team_size`）为 `null` 时前端整行不渲染
- `metadata` 为自定义 KV，按 `sort` 升序；每条**必带 `kind`**（`meta` | `metric`，恒不为空，见 4.1.1）；`notes` 只含已发布笔记，按发布时间倒序
- `screenshots[]` 为 `{ id, url, caption | null, sort }`，按 `sort` 升序，**无截图为 `[]`（不是 `null`，前端整块不渲染）**；只存原图 URL，见 4.1.1
- `notes[]` 为 `NoteSummary`，**必带 `excerpt`**（定义见 1.4 第 3 条）
- **旧 slug**（改名过）：`301 Moved Permanently`，`Location: /api/v1/projects/<new-slug>`；目标不可见时 404

### 3.3 `GET /notes` — 笔记列表

| 参数 | 说明 |
|---|---|
| `search` | 匹配 `title` / `body_md`，**按字面量**（`%` / `_` 不是通配符，见 3.7） |
| `tag` | 标签精确匹配 |
| `page` / `pageSize` | 分页 |

`items[]` 为 `NoteSummary`（同上 `notes` 元素结构，含 `excerpt`，见 1.4 第 3 条），按 `published_at` 倒序（空值再按 `created_at` 倒序）。

`NoteSummary.excerpt`（v1.2.3 起**必带，无例外**）：定义与取值以 **1.4 第 3 条为唯一出处**（本处不复述）。
列表 / 详情 / 后台三条路径共用同一序列化实现——详情不开口子，否则前端要为「有摘要」「没摘要」写两套渲染分支。

> 分组口径：F4 的「左栏按项目分组」由前端在已取回的列表上分组，本接口**不提供**分组聚合或 `project` 过滤参数。
> 笔记量级小（个人站），前端用 `pageSize=100` 一次取全后分组；跨页分组的语义不在本契约内。
>
> ⚠️ **`pageSize` 上限是 100（见 1. 通用约定）**：笔记超过 100 篇时单次只能拿到 100 条，
> 前端必须在 `total > 100` 时提示「笔记较多，分组仅显示最近 100 篇」，不能静默丢数据。
> 需要全量时由前端循环翻页（`page++` 直至 `page > totalPages`）后自行合并。

### 3.4 `GET /notes/:slug` — 笔记详情

`NoteSummary` + `body_md`；旧 slug 301；草稿或所属项目不可见 → 404。`excerpt` 随 `NoteSummary` **必带**（见 1.4 第 3 条），不因正文已含全文而省。

### 3.5 `GET /technologies` — 技术栈标签

```json
{ "items": ["Fastify", "Prisma", "TypeScript"] }
```

只汇总**前台可见项目**的技术栈名（去重升序），前台筛选下拉与后台编辑器共用。
该接口不接收 `search`，不涉及通配符转义。

### 3.6 `GET /health`

```json
{ "status": "ok", "uptime": 12.3 }
```

### 3.7 `search` 的匹配语义（通则）

`search` 一律**按字面量**匹配子串：SQL 的 `%` 与 `_` 是 LIKE 通配符，实现必须转义（`ESCAPE '\\'`）
或在应用层比较，否则用户搜「100%」「a_b」会命中无关记录。大小写不敏感的实现细节不属于契约（SQLite `LIKE` 对 ASCII 天然如此）。

| 端点 | 状态 |
|---|---|
| `GET /projects` | ✅ 已按字面量（应用层比较，见 `backend/src/routes/projects.ts`） |
| `GET /notes` | ✅ 已按字面量（`ESCAPE '\\'` + id 集合，见 `backend/src/routes/notes.ts`） |
| `GET /technologies` | — 不接收 `search` |
| `GET /admin/projects`、`GET /admin/notes` | ⚠️ 仍走未转义的 SQL `LIKE`：v1.2.3 批次文件范围锁定在前台三个路由，这两个留待下一批（与前台同规则，不得各自定义语义） |

## 4. 后台接口（`/api/v1/admin/**`，需 Bearer）

### 4.1 项目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/projects` | 列表；`publish_status` / `progress` / `search`（name、summary、slug 子串）/ `includeDeleted`（`true`/`1`）过滤；按 `updated_at` 倒序；额外返回 `counts` 见下 |
| GET | `/admin/projects/:id` | 详情，含**全部**笔记（含草稿，逐条带 `publish_status`）+ `publish_status` / `published_at` / `deleted_at` / `cover_source_url` |
| POST | `/admin/projects` | 新建，默认 `publish_status=draft`、`progress=ongoing`；201。**请求体不含 `links` / `metadata`**（见下「链接与元数据是独立资源」） |
| PATCH | `/admin/projects/:id` | 局部更新；slug 改名规则见下；状态机见 2.1 |
| DELETE | `/admin/projects/:id` | 软删除（写 `deleted_at`），幂等，返回详情 |
| POST | `/admin/projects/:id/restore` | 取消软删除 |
| POST | `/admin/projects/:id/links` | 新增一条链接（body `{type, label?, url, sort?}`），201，返回该链接；新增后异步触发健康检查（见 4.4） |
| PATCH | `/admin/links/:id` | 修改链接（`type` / `label` / `url` / `sort`）；**仅当 `url` 变化时**异步重检 |
| DELETE | `/admin/links/:id` | 删除链接，204 |
| PUT | `/admin/projects/:id/metadata` | 整体替换自定义 KV（body 是**裸数组** `[{key_label, value, sort?, kind?}]`，≤50 条，键名不得重复；`kind` 缺省 `meta`，见 4.1.1），返回项目详情 |

> **链接与元数据是独立资源**（对齐 v1.2 数据模型：`Link`/`ProjectMetadata` 是子表，不是项目表字段）：
> 新建项目只能带 `ProjectCreate` 里的字段，body 里多余的键（如 `links`、`metadata`）**被忽略而不是报错**——
> 所以「建项目 + 同时填链接」要分两步：先 `POST /admin/projects` 拿 `id`，再逐条 `POST /admin/projects/:id/links`。
> 元数据同理，用 `PUT .../metadata` 整体替换（空数组 = 清空）。键名字段是 **`key_label`**，不是 `key`。

**后台分段计数（B9）**：`GET /admin/projects` 的响应在分页信封上额外带 `counts`：

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 3, "totalPages": 1,
  "counts": { "all": 3, "draft": 1, "published": 1, "archived": 1 } }
```

口径：`search` + `includeDeleted` 过滤后、`publish_status` / `progress` 过滤前的集合；`all = draft + published + archived`。
分段切换不改 `counts`（分段数字始终是全部口径），搜索会重算。
与前台 `counts`（3.1）**方向对称**：都是「搜索过滤后、分段条件过滤前」，都不是全站总数。

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

**链接**（独立端点，`sort` 缺省追加到末尾）：

| 方法 | 路径 |
|---|---|
| POST | `/admin/projects/:id/links` → 201 |
| PATCH | `/admin/links/:id` |
| DELETE | `/admin/links/:id` → 204 |
| POST | `/admin/links/:id/check` → 200，立即重检（见 4.4） |

### 4.1.1 项目截图 与 元数据 `kind`（v1.2.6 新增）

截图与元数据都是**项目详情的子内容**，读写都以整个数组为单位（与 `/metadata` 同语义），**不是项目表字段**——建项目 / 改项目的 body 里带 `screenshots` / `metadata` 依旧被忽略。

**读**：`GET /projects/:slug`（3.2）与 `GET /admin/projects/:id` 的响应都带

```json
"screenshots": [{ "id": "s1", "url": "https://…/a.webp", "caption": "编辑器中的波形轨道（v2.4）", "sort": 0 }]
```

按 `sort` 升序；无截图为 `[]`（不是 `null`）。`caption` 为 `null` 表示无图注。

**写**：

| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/admin/projects/:id/screenshots` | 整体替换截图（body 是**裸数组**，≤10 条），返回更新后的后台详情；项目不存在 → 404 |

- **整体替换**：未出现在数组里的行被删除；`sort` 缺省用数组下标；`[]` = 清空。
- **校验**（全部走既有 400 `VALIDATION_ERROR` + `details[{path,message}]`，**不新增错误码**）：
  - `url` 必填，≤2048 且必须 `http(s)://`——`javascript:` / `data:` / 相对路径 / `ftp:` 一律 400。
  - `caption` 可空、≤80 字（按裁剪后长度）；**两端空白裁剪，空白字符串归一为 `null`**：wire 上不出现空串，客户端不必处理 `""`。
  - 一次 ≤10 张（第 11 张 → 400，整批拒绝）。
- **`sort` 可重复**：**客户端不得假设唯一，同值保持数组序**（服务端不因重复而拒绝，避免前端整批 400）。
- **不承诺**：URL 只存原图，后端不做派生尺寸（前端用 `object-fit` 处理）；截图**不进列表接口**（列表仍只有 3.1 的 `ProjectListItem` 字段）。

**元数据 `kind`**（`PUT /admin/projects/:id/metadata`，见 4.1）：

- 请求条目可选 `"meta" | "metric"`，**缺省 `meta`**——旧请求体不带 `kind` 也照样通过，不做破坏性变更。
- 响应 `metadata[]` 在**三条路径**（公开详情 3.2 / 后台详情 / 元数据写接口响应）都带 `kind`，值恒为 `meta` 或 `metric`。
- `metric` 上限：**≤2 条**（第 3 条 → 400）、`key_label` ≤16 字、`value` ≤12 字；`meta` 沿用 50 / 500（见 4.1）。
- 超限一律 400，`details` 逐项中文说明（含当前值与上限），**metric 按条数判、整批 400，不静默截断**。

**副作用**：任一次成功的截图 / 元数据替换都 **bump 项目 `updated_at`**（含传 `[]` 清空）——后台「保存了一下」也算一次内容变更。

**可观察后果（别当 bug 报）**：3.1 的 `sort=recent` 用 `last_updated_at ?? updated_at`（`backend/src/routes/projects.ts`），所以**没手填 `last_updated_at`** 的项目会因为一次空 PUT（如传 `[]` 清空）而在 recent 里提前；填了 `last_updated_at` 的项目不受影响。这是「保存即更新」的可接受语义。

### 4.2 笔记

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/notes` | 列表；`project_id` / `publish_status` / `search`（title、body_md、slug 子串）过滤；按 `updated_at` 倒序；**不含 `body_md`** |
| POST | `/admin/notes` | 新建，`project_id` 必填（项目不存在 → 404）；201 |
| GET | `/admin/notes/:id` | 详情，含 `body_md` |
| PATCH | `/admin/notes/:id` | 局部更新；`tags` 整体替换；`publish_status` 变更维护 `published_at`；slug 改名规则同项目 |
| DELETE | `/admin/notes/:id` | 硬删除，204 |

`NoteCreate` / `NoteUpdate`：`slug`（`^[a-z0-9-]{2,64}$`，note 命名空间唯一）、`title`（≤200）、
`body_md`（1..100k）、`publish_status`、`tags`（≤20 个，每个 ≤50）。

> slug 口径（收敛 B8 与第五节的措辞差异）：笔记 slug 在**笔记集合内**唯一，项目 slug 在**项目集合内**唯一，
> 两者可同名——`slug_aliases` 的唯一键是 `(entity_type, slug)`，`/projects/:slug` 与 `/notes/:slug` 是两个命名空间。
> B8 的「全站唯一」按此理解（不与项目 slug 互斥），否则两侧改名会互锁。

### 4.3 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | **公开接口（不需要 Bearer）**：`{ username, password }` → `{ token, expiresAt }`；失败 401 `UNAUTHORIZED`，不区分账号不存在与密码错误 |

> `Authorization: Bearer <token>` 只作用于 `/api/v1/admin/**`；`/auth/login`、`/health`、前台读接口均无需鉴权。

> 阶段 1 说明：登录仍读环境变量（`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`）；`admin_users` 表已随迁移建好，
> 改为库内账号（D1 密码登录）在阶段 2.1 落地。

### 4.4 链接健康检查（B16，v1.2.2 新增）

`Link` 上的三个只读字段由服务端维护，**写接口不接受**（传了忽略，不报错）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `last_status` | `"ok"` \| `"failed"` \| `"unknown"` | 上次检查结论；`unknown` = 从未检查（库内 `null`） |
| `last_http_status` | int \| null | 最后一次收到的 HTTP 状态码；未收到响应（超时/DNS 失败/被拦截）为 `null` |
| `last_checked_at` | ISO \| null | 上次检查时间 |

**判定口径**：`2xx` → `ok`；其余全部 `failed`——非 2xx（含 3xx 无 `Location`、4xx、5xx）、超时、DNS 解析失败、连接被拒/重置、
TLS 证书错误、被 SSRF 防护拦截。任何非 2xx 响应都写入 `last_http_status`。

**超时与跳转**：单跳 `5s`（连接 + 响应头，`LINK_CHECK_TIMEOUT_MS`），整体 `8s`（`LINK_CHECK_TOTAL_TIMEOUT_MS`）；
重定向最多 `3` 跳（`LINK_CHECK_MAX_REDIRECTS`），**每一跳都重新解析并重校验**。只请求响应头，不下载 body。

**触发时机**：

1. `POST /admin/projects/:id/links` 与 `PATCH /admin/links/:id`（仅当 `url` 变化）**异步**触发检查，
   不阻塞响应——保存响应里的 `last_status` 可能仍是 `unknown`，前端据此保守展示，不要把它当成刚检结果。
2. `POST /admin/links/:id/check` **同步**等待并返回更新后的 `Link`（最长约 8s），供后台「重检」按钮用。

**SSRF 防护（不可关闭）**：仅 `http` / `https`；主机名解析为 IP 后逐个校验，命中环回（`127/8`、`::1`）、
私网（`10/8`、`172.16/12`、`192.168/16`、`fc00::/7`）、链路本地与云元数据（`169.254/16` 含 `169.254.169.254`、`fe80::/10`）、
CGNAT、组播、保留/文档段的地址一律不发起连接，直接记 `failed`（`last_http_status` 为 `null`）；
IPv4 映射（`::ffff:`）、NAT64、6to4 里嵌入的 IPv4 同样按上述规则判定。
连接把 DNS 固定到已校验的 IP（校验与连接同一地址，防 DNS rebinding），重定向后的第二次解析同样重校验。

> 后台链接列的失效态与前台 F9 灰显都只认 `last_status === "failed"`；`unknown` 不灰显（没数据不等于坏了）。

## 5. 冻结核对与预留（ALICE-8，2026-10-21）

逐条核对《开发计划 v1.2》第五节 + `docs/frontend-gap-v1.2.md` 第一节后，本版补齐的缺口（均已实现 + 有测试）：

| # | 缺口 | 处理 |
|---|---|---|
| 1 | 后台列表没有分段计数（B9 要求「全部 / 已发布 / 草稿 / 已归档 + 计数」） | `GET /admin/projects` 新增 `counts`（口径见 4.1） |
| 2 | 后台项目详情笔记列表无 `publish_status`，编辑器无法区分草稿 | 详情 `notes[]` 增加 `publish_status` |
| 3 | 排序未定义 `stars` 空值次序 | `stars` 降序、null 最后、同分回 `recent` |
| 4 | `search` 匹配字段未写全 | 前后台各自的匹配字段已在 3.1 / 4.1 / 4.2 写明 |
| 5 | `/auth/login` 被列在「需 Bearer」小节，易被误实现 | 标注为公开接口，Bearer 只覆盖 `/admin/**` |
| 6 | B8「笔记 slug 全站唯一」与第五节两命名空间措辞冲突 | 按命名空间口径收敛（见 4.2 注） |
| 7 | 序列化命名悬而未决（gap 文档第一节末注） | 冻结为 `snake_case`（见 1. 通用约定） |
| 8 | Markdown 净化责任未写 | 后端存原文，前端渲染侧净化（N2） |

**预留（形状已定，实现未完成，前端本轮不要对接）**：

| 方法 | 路径 | 落地阶段 |
|---|---|---|
| GET | `/admin/overview` | 2.x（B12 P1 概览计数） |
| GET/PATCH | `/admin/settings` | 2.x（B13 P1 站点设置） |

> `POST /admin/links/:id/check`（B16）已在 v1.2.2 实现，见 4.4，不再属于预留。

## 6. 变更记录

| 版本 | 变更 |
|---|---|
| v1.0 | ALICE-6 MVP 冻结（单字段 `status`、笔记 1:1、`website` 链接类型、camelCase 字段） |
| v1.2 | 本文件：第五节口径落地，`publish_status`/`progress` 双字段、slug 定位 + 301、笔记 N:1、元数据固定列 + KV、链接枚举调整、`counts` 分段统计 |
| v1.2.1 | ALICE-8 冻结核对：后台 `counts`、后台详情笔记 `publish_status`、排序空值、search 字段、login 公开性、slug 命名空间、snake_case、Markdown 责任；补预留端点表 |
| v1.2.2 | B16 链接健康检查落地：`last_status` 改为 `ok`/`failed`/`unknown`（原 `null` 不再出现）、判定与超时口径、SSRF 防护、`POST /admin/links/:id/check`（见 4.4）；两套 `counts` 对称口径写明；`/notes` 超 100 篇截断提示 |
| v1.2.3 | 补三处此前只有实现没有条文的细节（见 1.4）：① 分页 `page > totalPages` 返回 200 + `items: []` + 真 `total` / `totalPages`，格式与范围错误仍 400，两条语义适用于全部列表端点；② `details[]` 结构保留、`code` 不承诺稳定、客户端不得分支（`code` 来源措辞由 v1.2.4 校正）；③ `NoteSummary.excerpt`（去 Markdown 取前 120 字、超长加省略号、空正文 `null`）为必带字段。同版登记：条文与 `backend/src/contract/schemas.ts` 成对维护、`search` 字面量匹配通则（见 3.7） |
| v1.2.4 | 信封层 `error.code` 值域归位：1.3 明确为唯一出处且 8 个值全冻结（FORBIDDEN 为保留位、METHOD_NOT_ALLOWED 当时记为「由框架 405 产生」——该判断由 v1.2.7 更正为保留值），1.2 增加值域段并规定「只允许对 `error.code` 分支、`code` 与状态冲突时以 `code` 为准」；同时校正 1.4 第 2 条的 `code` 来源措辞——不限于 zod issue code，`conflict` / `invalid_transition` 等手写标识同样存在且同样不得依赖 |
| v1.2.5 | compose 部署冒烟实测发现：建项目 body **不含** `links`/`metadata`（多余键被忽略而非报错），补 4.1「链接与元数据是独立资源」与 `POST /admin/projects/:id/links` / `PATCH|DELETE /admin/links/:id` 行；元数据 body 明确为裸数组、键名字段 `key_label`。**纯条文补正，无实现变更** |
| v1.2.6 | 项目截图与元数据 `kind` 落条文（见 3.2、4.1.1）：`screenshots[]` 形状与 `PUT /admin/projects/:id/screenshots` 整体替换（≤10 张、`http(s)`、`caption` ≤80 且空白归一 `null`）、`metadata[].kind` 三路径必带、metric ≤2 / ≤16 / ≤12 与 meta 50 / 500、替换 bump `updated_at`、URL 只存原图且截图不进列表。三条实现期假设固定为契约措辞：`sort` 可重复（客户端不得假设唯一，同值保持数组序）、`caption` 空白归一 `null`（wire 上不出现空串，客户端不必处理 `""`）、metric 按条数判且超限整批 400 不静默截断。**纯条文补正，无实现变更** |
| v1.2.7 | ① 1.3 把 `METHOD_NOT_ALLOWED` 标为**保留值、当前实现不产生**，删掉「由框架 405 产生」，并冻结行为「未知方法 → 404 `NOT_FOUND`」（不开启框架 405，避免暴露「路径存在但方法不对」这一维度）；② 1.4 第 2 条改为「结构必带、值不承诺稳定」：`field`/`code`/`message` 三键任何一侧都不得省略（含 mock），客户端**可展示不可分支**，可验证项为两侧 `Object.keys(details[0]).sort()` 相同；③ 4.1.1 补「传 `[]` 清空也算一次内容变更」的可观察后果（未填 `last_updated_at` 的项目会在 recent 提前）；④ 4.4 节位搬到 4.3 之后（纯搬移，无内容改动，行多重集与搬前一致）。**纯条文补正，无实现变更** |
