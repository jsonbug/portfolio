import type { NotePublishStatus } from './enums'

/** 笔记所属项目的最小引用（前台无需再请求项目详情）。 */
export interface NoteProjectRef {
  slug: string
  name: string
}

/** 笔记摘要：列表项，也是项目详情里「相关笔记」的元素。 */
export interface NoteSummary {
  id: string
  slug: string
  title: string
  project: NoteProjectRef
  tags: string[]
  published_at: string | null
  created_at: string
  updated_at: string
}

/** 前台笔记详情：摘要 + 正文（Markdown 原文）。 */
export interface NoteDetail extends NoteSummary {
  body_md: string
}

/** 后台笔记列表项：不含正文，额外带曝光状态与所属项目 id。 */
export interface AdminNoteListItem extends NoteSummary {
  publish_status: NotePublishStatus
  project_id: string
}

/** 后台笔记详情：编辑器回填用，含正文。 */
export interface AdminNoteDetail extends AdminNoteListItem {
  body_md: string
}

export interface NoteCreate {
  /** 所属项目必填（N:1）；项目不存在 → 404。 */
  project_id: string
  slug: string
  title: string
  body_md: string
  publish_status?: NotePublishStatus
  tags?: string[]
}

/** PATCH 语义：未传字段忽略；`tags` 传数组即整体替换（`[]` 清空）。 */
export type NoteUpdate = Partial<Omit<NoteCreate, 'project_id'>>

/** 后台笔记列表查询。 */
export interface AdminNoteQuery {
  page?: number
  pageSize?: number
  project_id?: string
  publish_status?: NotePublishStatus
  search?: string
}

/** 前台笔记列表查询。 */
export interface PublicNoteQuery {
  page?: number
  pageSize?: number
  search?: string
  tag?: string
}
