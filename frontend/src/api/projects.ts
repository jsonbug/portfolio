import { request } from './client'
import { buildQueryString } from './query'
import type {
  AdminProjectDetail,
  AdminProjectListEnvelope,
  MetadataItemInput,
  Progress,
  ProjectCreate,
  ProjectDetail,
  ProjectListCounts,
  ProjectListEnvelope,
  ProjectSort,
  ProjectUpdate,
  PublishStatus,
  ScreenshotInput,
} from '@/types'

/** 前台列表查询：`technology` 为数组，按重复参数下发。 */
export interface PublicProjectQuery {
  page?: number
  pageSize?: number
  search?: string
  technology?: string[]
  progress?: Progress
  sort?: ProjectSort
}

/** 后台列表查询：曝光状态与进展两个维度独立过滤。 */
export interface AdminProjectQuery {
  page?: number
  pageSize?: number
  publish_status?: PublishStatus
  progress?: Progress
  search?: string
  /** true 时包含已软删除项目（含 deleted_at）。 */
  includeDeleted?: boolean
}

// ---------- 前台（公开） ----------

/** 已发布项目列表 + 分段计数（计数在 search/technology 过滤后、progress 过滤前统计）。 */
export function listPublicProjects(query: PublicProjectQuery = {}): Promise<ProjectListEnvelope> {
  return request<ProjectListEnvelope>(`/projects${buildQueryString({ ...query })}`)
}

/** 按 slug 取项目详情；旧 slug 由浏览器跟随 301 落到新 slug（mock 同构）。 */
export function getPublicProject(slug: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`)
}

// ---------- 后台（Bearer） ----------

export function listAdminProjects(query: AdminProjectQuery = {}): Promise<AdminProjectListEnvelope> {
  return request<AdminProjectListEnvelope>(`/admin/projects${buildQueryString({ ...query })}`)
}

export function getAdminProject(id: string): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}`)
}

export function createProject(input: ProjectCreate): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>('/admin/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProject(id: string, input: ProjectUpdate): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/admin/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function restoreProject(id: string): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

/**
 * 整体替换自定义元数据（KV），数组顺序即 `sort`。
 *
 * body 是**裸数组**（契约 §4.1）：曾经按 `{ items }` 发包，真后端一律 400
 * ——契约表加了这一行才暴露，见 `test/contract/run.mjs` 的截图/kind 段。
 */
export function replaceProjectMetadata(
  id: string,
  items: MetadataItemInput[],
): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}/metadata`, {
    method: 'PUT',
    body: JSON.stringify(items),
  })
}

/** 整体替换项目截图：body 是裸数组，返回更新后的后台详情（会 bump `updated_at`）。 */
export function replaceProjectScreenshots(
  id: string,
  items: ScreenshotInput[],
): Promise<AdminProjectDetail> {
  return request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}/screenshots`, {
    method: 'PUT',
    body: JSON.stringify(items),
  })
}

export type { ProjectListCounts }
