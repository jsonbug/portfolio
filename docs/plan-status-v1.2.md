# v1.2 计划状态对照

> **基于 `139df5f`**（`main` 与 `integration/v1.2` 同点）。更新本表时只改这一行和对应行。
>
> 用途：计划表原件是 ALICE-4 的附件、不在仓库，本文件只做**状态对照**——不复制计划正文、不改写其措辞（两份文档互相打脸的成本比省下的字高）。
> 判定口径沿用验收阶段立下的规矩：判「已交付」必须给 `file:line`，判「未交付」必须说缺什么。

## 一、编号实际范围

| 系列 | 计划表中存在的编号 | 缺号 |
| --- | --- | --- |
| B（后台 / 数据） | B1–B9、B12–B17 | **B10、B11 不存在** |
| F（前台） | F1–F9（F10 明写「本期不做」） | — |

**B10 与 B11 都不存在**：计划表 B9 之后直接跳到 B12，全仓 `git grep -n "B10\|B11" 139df5f` 零命中，无对象可验。它们不是欠账，不要重派、也不要再去找「B11 的验收项」。

（附一条勘误：此前有一处说法是「B 系列实际到 B10，B11 断档」——不成立，B10 同样没有编号。以本表的 `git grep` 为准。）

## 二、F 系列（前台）

| 项 | 优先级 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| F1 项目列表 | P0 | 已交付 | `frontend/src/components/ProjectCover.vue:83`（卡片封面 `442/132`）、`:86`（hero `16:9`）、`:51-90`（首字兜底，非随机色块）；口径差异 ① |
| F2 项目详情 | P0 | 已交付 | `frontend/src/views/ProjectDetailView.vue:596`（hero `aspect-ratio: 16/9`，不写死 392px）、`:240`（截图轮播 `role="group"` + `截图 n/N` 计数）、`:261`（指标格）、`:289`（相关笔记）；口径差异 ③ |
| F3 链接展示 | P0 | 已交付 | `frontend/src/types/enums.ts:68-74`（五类文案）、`frontend/src/components/LinkTypeIcon.vue`（内联 SVG，根节点 `aria-hidden`）、`ProjectCard.vue:91`、`ProjectDetailView.vue:350/365`（新标签页 + `rel="noopener"` + 裸域名文本） |
| F4 笔记栏目 | P0 | 已交付 | `frontend/src/components/NoteTree.vue` 被 `NotesView.vue:123` 与 `NoteDetailView.vue:6` 共用（左栏分组 2 行截断 + 搜索）；`NoteTree.vue:85`「仅显示最近 100 篇」（`total > 100` 提示）；详情三栏 + 目录 + 上下篇 + 标签 + 阅读时长 |
| F5 元数据展示 | P0 | 已交付 | `ProjectDetailView.vue:91-100`（状态/进展两徽标堆叠 + 起始年份 + 我的角色 + 团队规模 + 开源协议，空值不渲染） |
| F6 搜索/筛选/排序 | P0 | 已交付 | `frontend/src/composables/useProjectListFilters.ts:25-29`（分段仅三项：全部 / 进行中 / 已上线，无归档）、`:31-34`（最近更新 / star）；300ms 防抖、URL query 持久化、空态「清除筛选」 |
| **F7 响应式** | P1 | **必修中（不通过）** | 390×844 coarse 实测 `documentElement.scrollWidth = 444 > innerWidth 390`（首页与 `/projects/:slug` 均成立），溢出元素 `.header-right`（`frontend/src/components/AppHeader.vue:49`）；coarse 热区实测：顶栏导航 39×52、分段 61×32、排序 `select` 108×36、轮播箭头 30×32、面包屑 26×26 —— 44px 只在 `frontend/src/style.css:305-310` 给了 `.btn-icon` |
| F8 关于页 | P1 | 移出 v1.2 | → ALICE-9。无 `/about` 路由、`AppHeader.vue` 无「关于」入口，**不存在死链** |
| F9 链接失效降级 | P1 | 已交付 | `ProjectDetailView.vue:360-373` 只对 `last_status === 'failed'` 降级，`ok` / `unknown` / `null` 同款渲染；口径差异 ② |
| F10 暗色模式 | P2 | 本期不做 | 计划原文即「本期不做」 |

## 三、B 系列（后台 / 数据）

| 项 | 优先级 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| B1 登录认证 | P0 | 已交付 | `frontend/src/utils/login.spec.ts:47-48`（401 固定文案，不透露账号是否存在）、`:52-53`（429 限流文案）、`frontend/src/views/admin/LoginView.vue:39`；边缘限流 `nginx.conf:36`（`rate=5r/m`）+ `:65`（`location = /api/v1/auth/login`）+ `:66`（`burst=4`）；口径差异 ⑥ |
| B2 项目创建/编辑 | P0 | 已交付 | 提示文案与计数：`frontend/src/views/admin/ProjectEditView.vue:434`（「建议 40–60 字，列表只显示 2 行，超出截断」）、`:436`（`n/60`）；两分区默认折叠：`:108-110`（`openMeta` / `openKv` 初值 false）、`:392-406`（元数据）、`:506-520`（自定义 KV，`aria-expanded` + 展开/收起）；口径差异 ④ |
| B3 封面图上传 | P0 | 移出 v1.2 | → ALICE-12（`git grep -n "upload\|multipart" -- backend/src frontend/src` 零命中，无 `sharp`/派生）。现只有 `cover_image_url` 手填 URL + CSS 裁切 + 首字兜底 |
| B4 项目删除 | P0 | 已交付 | `backend/src/routes/admin/projects.ts:6`（软删可 restore）、`:91`、`:253`（幂等置 `deleted_at`）；`backend/src/lib/slug.ts:1-8`（slug 别名保留，旧链接 301） |
| B5 双状态字段 | P0 | 已交付 | `ProjectEditView.vue:54-55`（`publish_status` / `progress` 独立）；前台可见性 `backend/src/routes/projects.ts:22-26`（仅 `published`）；前台分段 `useProjectListFilters.ts:25-29` 按 `progress` |
| B6 元数据固定字段 + KV | P0 | 已交付 | `ProjectEditView.vue:38-39/68`（KV 行）；同项目键名唯一与长度上限在 `backend/src/contract/schemas.ts`（`key_label` ≤50、`value` ≤500、≤50 条）；前台「固定在前、KV 按 sort 在后、空值整行不渲染」`ProjectDetailView.vue:91-100` 起 |
| B7 链接管理 | P0 | 已交付 | `ProjectEditView.vue:11/97/162`（增删改 + 排序）；类型枚举与文案 `types/enums.ts:68-74`；URL 必须 http(s)、同类型同 URL 不可重复在 `contract/schemas.ts` |
| B8 笔记管理 | P0 | 已交付 | `frontend/src/views/admin/NoteEditView.vue:22/31/109`（字段与必选）；实时预览；未保存离开提示 `frontend/src/composables/useUnsavedChanges.ts:11/43`；口径差异 ⑤ |
| B9 项目列表（后台） | P0 | 已交付 | `frontend/src/views/admin/projectColumns.ts:32-40`（7 列顺序 + `minWidth` 0/768/0/1024/0/1120/1280，`visibleColumns()` 只减不重排）；分段序 `ProjectListView.vue:62-67`（全部→已发布→草稿→已归档，`SEGMENTS`）；`note_count` 渲染 `:45`（`笔记 ${item.note_count}`）；后台最小宽 `style.css:120`（`--admin-min-width: 768px`） |
| B10 | — | **编号不存在** | 见 §一 |
| B11 | — | **编号不存在** | 见 §一 |
| B12 后台概览 | P1 | 移出 v1.2 | → ALICE-10 |
| B13 基础设置 | P1 | 移出 v1.2 | → ALICE-9（与 F8 同一单：关于页正文就是「设置里的 Markdown」，拆开做等于写两遍草稿） |
| B14 元数据字段管理 | — | 本期不做 | 计划原文即「本期不做」；`git grep -n "字段管理" frontend/src` 零命中，无该 UI |
| B15 项目 slug / 路由 | P0 | 已交付 | `backend/src/lib/slug.ts:1-8`（旧 slug 301 别名）；`backend/src/routes/admin/notes.ts:138`（曾发布才留历史，草稿改 slug 不留）；格式与唯一性在 `contract/schemas.ts` + 冲突 409 |
| B16 链接可用性检查 | P0 | 已交付 | `backend/src/routes/admin/links.ts:5/7/14`（`POST /admin/links/:id/check`，同步、失败不阻塞保存）；`types/enums.ts:39-44`（`last_status`）；SSRF 防护在 `backend/src/lib/link-check.ts`；口径差异 ⑦ |
| B17 链接批量检查 | P1 | 移出 v1.2 | → ALICE-11（无定时任务、无批量重检接口） |

## 四、口径差异（实现与计划措辞不一致，均已拍板）

| # | 位置 | 计划措辞 | 实际实现 | 理由 |
| --- | --- | --- | --- | --- |
| ① | F1 封面尺寸 | 「卡片含封面（16:9 或首字兜底）」 | 卡片封面 `442×132`（3.35:1，按效果图 `01`），hero 才用 `16:9`；尺寸口径属上传管线的派生规格（B3 → ALICE-12） | 计划那句「16:9」与效果图不一致时**以效果图为准**；两档派生尺寸本就由 B3 定义，v1.2 用 CSS 裁切实现，比例与效果图一致 |
| ② | F9 失效链接 | 「灰显且**不可点**，hover 提示『链接暂不可用』」 | 低对比 + `⚠` + `title`「链接检查失败，仍可尝试打开」，**仍可点** | `last_status = failed` 只代表某次探测失败（8s 超时 / DNS 抖动 / SSRF 拦截都记 failed），假阳性率高；因一次探测失败剥夺访问一个可能正常的仓库，代价大于收益 |
| ③ | F2 指标条 | 效果图 `02` 是 4 格（Stars / gzip 包体 / fps / 版本） | 按 `METRIC_LIMITS.max`（=2）渲染 1–2 格，**不满不补空位**；`stars` 与 `version` 留在 hero 行 | 4 格里只有 2 格是自定义指标，把固定字段搬进格子会在 hero 行重复显示同一批数字；放宽上限到 4 要同时改契约 + schema + 后端 + 前端 + 测试五处，收益不成比例 |
| ④ | B2 编辑形态 | 「**抽屉内**并列二级折叠」 | 独立路由页 `/admin/projects/:id/edit`，两个分区仍默认折叠 | 抽屉里要放 20+ 字段，480 宽必然长滚，抽屉唯一的收益（编辑时还能看见列表）被滚动抵消，还多一层嵌套滚动容器；功能等价，只是形态差异 |
| ⑤ | B8 状态条 | 效果图 `06` 底部状态条横跨全宽 | 只在中栏（编辑器自己的底边） | 三栏是三块并列的工作面，全宽条会把编辑器从三栏里视觉切出来；「未保存 N 处」本就是编辑器的状态 |
| ⑥ | B1 「剩余 N 次尝试」 | 计划未写此条，实现侧曾有提案 | **不实现**。限流在 nginx 边缘（`nginx.conf:36` `rate=5r/m`、`:66` `burst=4`、`:65` 只挂 `POST /api/v1/auth/login`、429 为 nginx HTML 无 `error.code`），后端不建计数表、契约 §1.3 值域不动 | 单管理员登录防的是公网暴力破解，边缘限流足够；且不向未认证方暴露尝试状态（把剩余次数显示给攻击者本身是净负收益）。前端保留 `429 → 尝试次数过多` 分支，边缘触发后即生效 |
| ⑦ | B16 状态枚举 | 「`last_status ∈ {ok, timeout, error}`」 | 实际 `{ok, failed, unknown}`（`types/enums.ts:39-44`，契约同值域） | 三态**语义**保留（正常 / 检查失败 / 未检查）；`failed` 一档吸收了超时与错误，区分超时/错误对前台降级判断没有用。**本条待研发负责人确认登记**，未拍板前按「已实现口径」记录，不算「按计划通过」 |

## 五、移出 v1.2 的条目

| 原编号 | 去向 | 移出理由摘要 |
| --- | --- | --- |
| F8 关于页 + B13 基础设置 | ALICE-9 | v1.2 验收清单未含「关于」内容；两者互相依赖（关于页正文来自设置），一起做才不写两遍 |
| B3 封面上传管线 | ALICE-12 | 挂在未定的部署形态上（本地卷 vs 对象存储）；本身是独立子系统（multipart + 校验 + 主图 + 原图另存 + 两档派生 + 长图角标 + 清理）；前台无断链 |
| B12 后台概览 | ALICE-10 | P1，与后台列表页信息重叠，发布前不阻塞 |
| B17 链接批量检查 | ALICE-11 | P1，需定时任务与运维语义，与「链接检查」同步版解耦后单独做 |

## 六、状态取值

- **已交付**：代码在 `139df5f` 上可指认，且有用例或实测证据。
- **必修中（不通过）**：有明确缺陷、已派单，未修完前该项验收不成立（当前仅 F7）。
- **移出 v1.2**：已建单，不属于 v1.2 验收范围；不算欠账。
- **本期不做**：计划原文自述不做。
- **编号不存在**：计划表本身没有这个编号，无对象可验。
