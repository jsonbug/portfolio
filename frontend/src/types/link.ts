import type { LinkType } from './enums'

export interface Link {
  id: string
  type: LinkType
  label: string | null
  url: string
  sortOrder: number
  createdAt: string
}

export interface LinkCreate {
  type?: LinkType
  label?: string | null
  url: string
  sortOrder?: number
}

export interface LinkUpdate {
  type?: LinkType
  label?: string | null
  url?: string
  sortOrder?: number
}
