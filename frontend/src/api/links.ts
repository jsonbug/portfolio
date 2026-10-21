import { request } from './client'
import type { Link, LinkCreate, LinkUpdate } from '@/types'

export function addLink(projectId: string, input: LinkCreate): Promise<Link> {
  return request<Link>(`/admin/projects/${encodeURIComponent(projectId)}/links`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** `sort` 参与排序：越小越靠前（前台按升序渲染）。 */
export function updateLink(id: string, input: LinkUpdate): Promise<Link> {
  return request<Link>(`/admin/links/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** 立即重检（同步，最长约 8s）——后台「重检」按钮用。 */
export function checkLink(id: string): Promise<Link> {
  return request<Link>(`/admin/links/${encodeURIComponent(id)}/check`, { method: 'POST' })
}

export function deleteLink(id: string): Promise<void> {
  return request<void>(`/admin/links/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
