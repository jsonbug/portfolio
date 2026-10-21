/**
 * 契约枚举（冻结值，v1.2），与 backend/src/contract/schemas.ts 保持一致。
 * 中文标签仅用于展示，不参与契约。
 */

/**
 * 曝光状态（`publish_status`）：决定前台是否可见。
 * draft → published → archived；`published` 可撤回为 `draft`。
 */
export const PublishStatus = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
} as const
export type PublishStatus = (typeof PublishStatus)[keyof typeof PublishStatus]

/**
 * 项目进展（`progress`）：内容维度，与曝光状态正交，不参与可见性判定。
 * 前台分段只有「全部 / 进行中 / 已上线」。
 */
export const Progress = {
  ongoing: 'ongoing',
  launched: 'launched',
} as const
export type Progress = (typeof Progress)[keyof typeof Progress]

/** 链接类型：repo 仓库 / site 官网 / docs 文档 / demo 演示 / other 其他 */
export const LinkType = {
  repo: 'repo',
  site: 'site',
  docs: 'docs',
  demo: 'demo',
  other: 'other',
} as const
export type LinkType = (typeof LinkType)[keyof typeof LinkType]

/** 链接健康检查结果（只读，由后端检查任务写入）。 */
/** 链接健康检查结论：`unknown` = 从未检查（库里是 null，wire 上不出现 null）。 */
export const LinkStatus = {
  ok: 'ok',
  failed: 'failed',
  unknown: 'unknown',
} as const
export type LinkStatus = (typeof LinkStatus)[keyof typeof LinkStatus]

/** 笔记曝光状态（笔记没有 archived）。 */
export const NotePublishStatus = {
  draft: 'draft',
  published: 'published',
} as const
export type NotePublishStatus = (typeof NotePublishStatus)[keyof typeof NotePublishStatus]

/** 前台列表排序：recent 按最近更新（空则回退系统更新时间）/ stars 按 star 数。 */
export type ProjectSort = 'recent' | 'stars'

export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

export const PROGRESS_LABELS: Record<Progress, string> = {
  ongoing: '进行中',
  launched: '已上线',
}

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  repo: '仓库',
  site: '官网',
  docs: '文档',
  demo: '演示',
  other: '其他',
}

export const NOTE_PUBLISH_STATUS_LABELS: Record<NotePublishStatus, string> = {
  draft: '草稿',
  published: '已发布',
}
