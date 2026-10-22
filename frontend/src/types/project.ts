import type { Progress, PublishStatus } from './enums'
import type { Link } from './link'
import type { NoteSummary, AdminNoteSummary } from './note'

/**
 * 元数据条目类型（契约 4.1.1）：
 * - `meta`：右栏元数据 panel 的普通 KV 行；
 * - `metric`：详情页「指标」统计格的格子（≤2 条、键值更短）。
 */
export type MetadataKind = 'meta' | 'metric'

/** 自定义元数据（KV）：按 `sort` 升序渲染，键名在同一项目内唯一。 */
export interface MetadataItem {
  key_label: string
  value: string
  kind: MetadataKind
  sort: number
}

/** 写入用元数据项（`sort` / `kind` 可省略，`kind` 缺省 `meta`，`sort` 按数组顺序补齐）。 */
export interface MetadataItemInput {
  key_label: string
  value: string
  kind?: MetadataKind
  sort?: number
}

/** 项目截图（契约 4.1.1）：只存原图 URL，顺序由 `sort` 决定。 */
export interface Screenshot {
  id: string
  url: string
  /** `null` 表示无图注（后端把空白字符串归一为 null）。 */
  caption: string | null
  sort: number
}

/** 写入用截图（整体替换，`sort` 缺省按数组下标）。 */
export interface ScreenshotInput {
  url: string
  caption?: string | null
  sort?: number
}

/** 列表项：前台公开形态（不含曝光状态与软删除标记）。 */
export interface ProjectListItem {
  id: string
  slug: string
  name: string
  summary: string | null
  cover_image_url: string | null
  progress: Progress
  stars: number | null
  version: string | null
  last_updated_at: string | null
  tech_stack: string[]
  links: Link[]
  created_at: string
  updated_at: string
}

/** 详情：列表项 + 正文、固定元数据列、自定义 KV 与相关笔记（仅已发布）。 */
export interface ProjectDetail extends ProjectListItem {
  description_md: string | null
  role: string | null
  license: string | null
  start_year: number | null
  team_size: number | null
  metadata: MetadataItem[]
  /** 无截图为 `[]`（不是 `null`）。 */
  screenshots: Screenshot[]
  notes: NoteSummary[]
}

/** 后台列表项：额外含曝光状态、首次发布时间与软删除标记。 */
export interface AdminProjectListItem extends ProjectListItem {
  publish_status: PublishStatus
  published_at: string | null
  deleted_at: string | null
  /** 该项目全部笔记数（草稿 + 已发布），与 search / publish_status 过滤无关。 */
  note_count: number
}

/** 后台项目详情：含草稿笔记与封面原图。 */
export interface AdminProjectDetail extends Omit<ProjectDetail, 'notes'> {
  notes: AdminNoteSummary[]
  publish_status: PublishStatus
  published_at: string | null
  cover_source_url: string | null
  deleted_at: string | null
}

/** 新建请求（POST /admin/projects）：`slug` 与 `name` 必填。 */
export interface ProjectCreate {
  slug: string
  name: string
  summary?: string | null
  description_md?: string | null
  cover_image_url?: string | null
  cover_source_url?: string | null
  publish_status?: PublishStatus
  progress?: Progress
  stars?: number | null
  version?: string | null
  last_updated_at?: string | null
  role?: string | null
  license?: string | null
  start_year?: number | null
  team_size?: number | null
  /** 传数组即整体替换，顺序即 sort。 */
  tech_stack?: string[]
}

/** PATCH 语义：未传字段忽略；显式 `null` 清空可空字段。 */
export type ProjectUpdate = Partial<ProjectCreate>
