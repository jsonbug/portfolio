import type { ProjectLifecycle, ProjectStatus } from './enums'
import type { Link } from './link'
import type { Note } from './note'

/** 列表项：前台与后台列表共用的精简形态（不含 deletedAt，见下方 Admin 扩展）。 */
export interface ProjectListItem {
  id: string
  name: string
  tagline: string | null
  status: ProjectStatus
  stars: number | null
  lastActivityAt: string | null
  coverImage: string | null
  technologies: string[]
  createdAt: string
  updatedAt: string
}

/** 详情：在列表项之上补充元数据、链接与 1:1 笔记。 */
export interface ProjectDetail extends ProjectListItem {
  description: string | null
  role: string | null
  projectStatus: ProjectLifecycle | null
  startDate: string | null
  endDate: string | null
  githubRepo: string | null
  links: Link[]
  note: Note | null
}

/** 后台列表项：列表项 + 软删除标记（契约已冻结 deletedAt，仅 /admin/* 返回）。 */
export interface AdminProjectListItem extends ProjectListItem {
  deletedAt: string | null
}

/** 后台详情：详情 + 软删除标记（契约已冻结 deletedAt，仅 /admin/* 返回）。 */
export interface AdminProjectDetail extends ProjectDetail {
  deletedAt: string | null
}

/** 创建请求：仅 name 必填，其余可选（含 technologies 按名 upsert）。 */
export interface ProjectCreate {
  name: string
  tagline?: string | null
  description?: string | null
  status?: ProjectStatus
  stars?: number | null
  lastActivityAt?: string | null
  role?: string | null
  projectStatus?: ProjectLifecycle | null
  startDate?: string | null
  endDate?: string | null
  githubRepo?: string | null
  coverImage?: string | null
  technologies?: string[]
}

/** 更新请求：创建请求的 Partial 形态（PATCH 语义）。 */
export type ProjectUpdate = Partial<ProjectCreate>
