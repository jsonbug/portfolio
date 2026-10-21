import { request } from './client'
import type { Note, NoteUpsert } from '@/types'

/** 创建或整体替换项目的 1:1 笔记。 */
export function upsertNote(projectId: string, input: NoteUpsert): Promise<Note> {
  return request<Note>(`/admin/projects/${encodeURIComponent(projectId)}/note`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteNote(projectId: string): Promise<void> {
  return request<void>(`/admin/projects/${encodeURIComponent(projectId)}/note`, { method: 'DELETE' })
}
