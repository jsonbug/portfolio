import type { Progress, PublishStatus } from './enums'
import type { Link } from './link'
import type { NoteSummary } from './note'

/** 自定义元数据（KV）：按 `sort` 升序渲染，键名在同一项目内唯一。 */
export interface MetadataItem {
  key_label: string
  value: string
  sort: number
}

/** 写入用元数据项（`sort` 可省略，由后端按数组顺序补齐）。 */
export interface MetadataItemInput {
  key_label: string
  value: string
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
  notes: NoteSummary[]
}

/** 后台列表项：额外含曝光状态、首次发布时间与软删除标记。 */
export interface AdminProjectListItem extends ProjectListItem {
  publish_status: PublishStatus
  published_at: string | null
  deleted_at: string | null
}

/** 后台详情：含草稿笔记与封面原图。 */
export interface AdminProjectDetail extends ProjectDetail {
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
