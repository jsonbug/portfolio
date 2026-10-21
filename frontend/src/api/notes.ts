import { request } from './client'
import { buildQueryString } from './query'
import type {
  AdminNoteDetail,
  AdminNoteListItem,
  AdminNoteQuery,
  ListEnvelope,
  NoteCreate,
  NoteDetail,
  NoteSummary,
  NoteUpdate,
  PublicNoteQuery,
} from '@/types'

// ---------- 前台（公开）：只返回 published ----------

export function listPublicNotes(query: PublicNoteQuery = {}): Promise<ListEnvelope<NoteSummary>> {
  return request<ListEnvelope<NoteSummary>>(`/notes${buildQueryString({ ...query })}`)
}

/** 按 slug 取笔记详情；旧 slug 由 301 落到新 slug，所属项目不可见时 404。 */
export function getPublicNote(slug: string): Promise<NoteDetail> {
  return request<NoteDetail>(`/notes/${encodeURIComponent(slug)}`)
}

// ---------- 后台（Bearer）：N:1，项目下可有多篇 ----------

export function listAdminNotes(query: AdminNoteQuery = {}): Promise<ListEnvelope<AdminNoteListItem>> {
  return request<ListEnvelope<AdminNoteListItem>>(`/admin/notes${buildQueryString({ ...query })}`)
}

export function getAdminNote(id: string): Promise<AdminNoteDetail> {
  return request<AdminNoteDetail>(`/admin/notes/${encodeURIComponent(id)}`)
}

export function createNote(input: NoteCreate): Promise<AdminNoteDetail> {
  return request<AdminNoteDetail>('/admin/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateNote(id: string, input: NoteUpdate): Promise<AdminNoteDetail> {
  return request<AdminNoteDetail>(`/admin/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteNote(id: string): Promise<void> {
  return request<void>(`/admin/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
