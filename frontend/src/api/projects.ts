import { request } from './client'
import type {
  AdminProjectDetail,
  AdminProjectListItem,
  ListEnvelope,
  ProjectCreate,
  ProjectDetail,
  ProjectListItem,
  ProjectUpdate,
} from '@/types'

export interface PublicProjectQuery {
  page?: number
  pageSize?: number
  search?: string
  technology?: string
}

export interface AdminProjectQuery {
  page?: number
  pageSize?: number
  /** true 时包含已软删除项目（含 deletedAt）。 */
  includeDeleted?: boolean
  status?: string
  search?: string
}

function toQueryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

// ---------- 前台（公开） ----------

export function listPublicProjects(query: PublicProjectQuery = {}): Promise<ListEnvelope<ProjectListItem>> {
  return request<ListEnvelope<ProjectListItem>>(`/projects${toQueryString(query)}`)
}

export function getPublicProject(id: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`)
}

// ---------- 后台（Bearer） ----------

export function listAdminProjects(query: AdminProjectQuery = {}): Promise<ListEnvelope<AdminProjectListItem>> {
  return request<ListEnvelope<AdminProjectListItem>>(`/admin/projects${toQueryString(query)}`)
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
