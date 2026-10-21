/** 项目笔记（1:1），正文为纯 Markdown。 */
export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface NoteUpsert {
  title: string
  content: string
}
