import type { LinkStatus, LinkType } from './enums'

/** 项目相关链接（独立端点维护，`sort` 升序）。健康检查字段只读。 */
export interface Link {
  id: string
  type: LinkType
  label: string | null
  url: string
  sort: number
  last_status: LinkStatus
  last_http_status: number | null
  last_checked_at: string | null
  created_at: string
}

export interface LinkCreate {
  type?: LinkType
  label?: string | null
  url: string
  /** 缺省由后端追加到末尾。 */
  sort?: number
}

export interface LinkUpdate {
  type?: LinkType
  label?: string | null
  url?: string
  sort?: number
}
