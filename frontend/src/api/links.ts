import { request } from './client'
import type { Link, LinkCreate, LinkUpdate } from '@/types'

export function addLink(projectId: string, input: LinkCreate): Promise<Link> {
  return request<Link>(`/admin/projects/${encodeURIComponent(projectId)}/links`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateLink(id: string, input: LinkUpdate): Promise<Link> {
  return request<Link>(`/admin/links/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteLink(id: string): Promise<void> {
  return request<void>(`/admin/links/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
