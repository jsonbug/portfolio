# 前端「现有代码 vs v1.2」gap 清单

> 基线：`jsonbug/portfolio` `main` = `8f65630`（ALICE-6 交付的 MVP，按 v1.1 之前口径实现）。
> 依据：ALICE-4 的 `开发计划-项目展示平台-v1.2.md`（第五节数据模型 + 路由表 + 决策表）与 11 张效果图。
> 结论：**是改造，不是重写。** 工程骨架、请求层（`api/client.ts` 的 401/token/mock 开关）、Markdown 消毒、封面组件、a11y 基础（focus ring / badge 双编码）都可留用；需要动的是**契约类型、路由、四个页面与令牌层**。
> 另外记录一个仓库状态异常：远端 `main` 在 2026-10-21 23:03 被 force-push 成单个 `Initial commit`（仅 `LICENSE`），MVP 代码只存在于 `8f65630` 与本地分支，详见文末。

## 一、契约与类型（影响面最大，先改）

| 现有 | v1.2 要求 | 处理 |
|---|---|---|
| `types/enums.ts` 单字段 `ProjectStatus`（draft/published/archived）承载「发布状态」 | 拆 `publish_status` + `progress ∈ {ongoing, launched}` 两个正交字段 | 新增 `PublishStatus` / `Progress`，标签「已发布/草稿/已归档」「进行中/已上线」 |
| `ProjectLifecycle`（active/completed/maintained/paused）当项目进展 | 四值生命周期作废 | 删除该枚举与 `PROJECT_LIFECYCLE_LABELS` |
| `LinkType` = repo/website/demo/other | `repo\|site\|docs\|demo\|other` | `website → site`，新增 `docs` |
| `ProjectListItem.tagline` | `summary`（≤60 字） | 重命名 + 表单计数 `n/60` + 固定提示文案 |
| 无 `slug`，详情路由 `/projects/:id` | `slug` 必填唯一，`/projects/:slug`，改名 301 | 路由参数改 `slug`；前端只负责消费后端 301，不做别名表逻辑 |
| 单 `coverImage` | `cover_image_url`（1600×900）+ `cover_source_url`（原图） | 类型两字段；列表用 442×132 派生、详情用 16:9 等比（不写死 392px） |
| `role` 有，`startDate/endDate` 有，无 `license/start_year/team_size` | 固定列 `role/license/start_year/team_size` + `project_metadata` 自由 KV | 类型加固定列 + `metadata: {keyLabel, value, sort}[]`；详情按「固定字段在前、KV 按 sort」渲染，空值整行不渲染 |
| `note` 1:1 内嵌在 detail | `notes` 独立实体（`slug/title/body_md/publish_status/project_id/tags`） | `Note` 重写；detail 返回 `notes[]`（该项目笔记列表） |
| `api/notes.ts` 只有 `PUT /admin/projects/:id/note` | `/admin/notes` CRUD + 公开 `/notes`、`/notes/:slug` | 重写 notes api |
| 无 `version/last_updated_at` | 列表/详情展示 `stars · version · last_updated_at`（手填） | 类型 + 卡片/详情 |
| `mocks/db.ts`、`mocks/handlers.ts` 全按旧契约 | 按第五节重建（含 slug 301、`published` 可见性口径） | 重写（前端并行开工的运行基础） |

> 前端沿用现有 camelCase 序列化（`publishStatus` / `progress` / `coverImageUrl`），待后端 delta 确认；若后端改为 snake_case，改 `types/*` + 序列化层即可，页面不感知。

## 二、路由

| 现有 | v1.2 | 处理 |
|---|---|---|
| `/`、`/projects/:id` | `/`、`/projects/:slug` | 改参数名 |
| 无 | `/notes`、`/notes/:slug`、`/about` | 新增（笔记是独立一级栏目） |
| `/admin`、`/admin/projects`、`/admin/projects/:id` | 另加 `/admin/notes`、`/admin/notes/:id`、`/admin/links`、`/admin/settings` | 本轮补 notes；概览/链接检查/设置属 P1 |
| 无前台导航 | 一级导航「项目 / 笔记 / 关于」+ 搜索 + 后台入口 + 头像 | 新增 `AppHeader` |

## 三、前台页面

**HomeView（列表）**
- 缺：页头（`Display 44`、汇总「N 个项目 · 最近更新 x 天前」）、筛选条、空态/骨架、加载态。
- 卡片缺：状态徽标（progress 双编码）、star + 更新时间、仓库/官网双入口图标、`summary` 2 行截断（现 tagline 单行）。
- 现有 `grid-template-columns: minmax(320px,1fr)` → 按断点 ≥1280 三列 / 768–1279 两列 / <768 单列。
- 无搜索（300ms 防抖，匹配名称+摘要）/ 技术栈多选 / 排序（最近更新 / star）/ URL query 同步 / 「清除筛选」。
- `getPublicProject(id)` 直连 detail：需改为 slug。
- 封面卡片比例已是 `442/132` ✓（保留），但无 `star · 日期` 与双入口。

**ProjectDetailView**
- 结构完全不对：现为「hero + 三个纵向 section」，v1.2 为**左栏内容 + 右栏 3 panel（元数据 / 相关链接 / 技术栈）**。
- hero：现有 `ProjectCover variant=hero` 已是 `aspect-ratio: 16/9` ✓；需确认 2 列/1 列时按容器等比缩放，不写死 392px ✓（继续不写死）。
- 缺：要点、截图、指标（star/版本）、相关笔记列表；「维护节奏」不得出现（现有本来没有 ✓）。
- 元数据现为 `meta` 列表（stars/角色/状态/周期/仓库）→ 改固定字段 + KV，空值整行不渲染。
- 链接：需按类型渲染图标与文案 + 裸域名 + `rel="noopener"`；现仅文字 + 全 URL。

**笔记（缺失）**
- 无 `NotesView` / `NoteDetailView`：`/notes` 左栏按项目分组（中文长标题 2 行截断）+ 搜索、中栏正文；`/notes/:slug` 含 h2/h3 目录、所属项目卡、上下篇、标签、阅读时长。
- 无 `AppHeader`，笔记进不了一级导航。

**AboutView（P1）** 未做，本轮不排。

## 四、后台页面

**ProjectListView**
- 列：现有「选择 / 项目 / 状态 / 技术栈 / 更新时间 / 操作」6 列 → v1.2 固定 7 数据列「名称 → slug → 发布状态 → 进展 → 链接 → 更新时间 → 操作」（复选框为工具列，不算 7 列）。
- 隐列方向反了：现为「更新时间内嵌 + 技术栈内嵌 + <960 卡片化」→ 改为**从右往左逐列隐藏 操作 → 更新时间 → 进展 → slug**，名称/发布状态/链接任何宽度都不隐藏，最小 768。
- 缺：`slug` 列、`进展` 徽标、`链接` 列（仓库/官网双图标 + 失效态）、分段（全部/已发布/草稿/已归档 + 计数）。
- 已归档徽标文字必须 `#6E6862` 且保留实心方块（现 `AppBadge` 只有圆点形态）。
- 现有 `<960` 卡片化方案与 B9「<768 不做适配」冲突，删除。

**ProjectEditView**（461 行）
- 字段缺 `slug`（含 `^[a-z0-9-]{2,64}$` 提示、改名 301 提示）、`summary` 计数、`progress`、封面双图与「预览裁切」、`version`、固定元数据（起始年份/团队规模/角色/开源协议）、自定义 KV、「固定元数据」「自定义 KV」默认折叠、链接检查三态 + 重检、保存草稿/保存并发布。
- 现有 `projectStatus` 单选、`startDate/endDate`、`githubRepo`、`tagline` 需移除或映射。

**LoginView（D1）** 结构已符合（仅账号+密码+错误态，无注册/找回）→ 只做视觉对齐（令牌）。

**笔记编辑器（D2，缺失）** 无 `/admin/notes/:id`：Markdown + 实时预览、标签输入、项目单选、未保存离开提示、发布。

**AdminLayout** 侧栏仅「项目列表 / 新建项目」→ 需「概览 / 项目 / 笔记 / 链接检查 / 设置」。

## 五、设计令牌层（M2 交付项，本轮先落）

`style.css` 已有方向 A 的色板骨架，但与 Style Tile 相比缺：

| 缺项 | 规格 |
|---|---|
| 字号阶梯 | Display 44/52（tracking −2.5%）、H1 32/40、H2 22/32、Body 15/26、Small 13/21、Mono 12/18 |
| 间距刻度 | 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64（现有 34、52 不在刻度上，改为 32、48） |
| 阴影 | 仅 `e1` → 补 `e2` 悬停/图片、`e3` 抽屉/弹层 |
| 语义色 | 缺 `--c-accent-soft #FBE0E6`、已归档中性 `#F1EFEC` + 文字 `#6E6862` |
| 控件描边 | 输入框描边应为 `#D6D1C8`（现复用 `--c-border #E6E2DB`） |
| 控件尺寸 | 主按钮 h38 / 小号 h32 / 输入 h36 / 图标 28 + 热区 40 / 触控 ≥44×44 |
| 封面渐层 | 6 套预设只在 `utils/cover.ts` 里有 hex，未进令牌层（保持唯一来源即可） |
| 布局 | 内容区 1376px、卡片 24 间距、后台最小 768 |

## 六、组件

| 现有 | 需要 |
|---|---|
| `StatusBadge` 按单字段出圆点 | 拆 `PublishStatusBadge`（圆点/空环/方块）+ `ProgressBadge`（半环/对勾） |
| `AppBadge` 只有圆点形态 | 支持 `shape: dot \| ring \| square \| half \| check`（形状 + 文字双编码） |
| `ProjectCover` 兜底为**渐层 + 首字** | D4 改为「首字（38/56 两档）+ 16px 网格底」，纵向长图 `h/w > 1.2` 顶部对齐 + 「长图」角标 |
| 无 `AppHeader` / `TechTag` / `MetaPanel` / `LinkList` | 新增（详情右栏 3 panel 复用） |

## 七、测试

现有 53 个用例全部围绕旧契约（`tagline`、`/projects/:id`、6 列后台表）。改造时按新口径重写对应 spec；新增：令牌断言、列表分段/搜索/空态、详情 3 panel 空值不渲染、笔记页、后台 7 列隐列。

## 八、建议落地顺序（每步一个 PR）

1. **设计令牌**（本 PR）：`style.css` 令牌层 + 令牌断言测试。（M2「设计令牌可用」）
2. 契约类型 + api + mocks 重做（前端并行开工的运行基础，与后端 delta 对齐）。
3. 前台列表（分段/搜索/筛选/排序/URL 同步/空态/卡片）。
4. 前台详情（左右分栏 + 3 panel + 相关笔记）。
5. 笔记栏目（`/notes`、`/notes/:slug`）。
6. 后台列表 7 列 + 隐列规则；7. 后台笔记编辑器 D2；8. 登录视觉对齐 D1。
