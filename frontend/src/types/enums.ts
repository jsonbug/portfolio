/**
 * 契约枚举（冻结值），与 backend/src/contract/schemas.ts 保持一致。
 * 中文标签仅用于前台展示，不参与契约。
 */

/** 发布状态：draft 草稿 / published 已发布 / archived 已下架 */
export const ProjectStatus = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
} as const
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

/** 链接类型：repo 仓库 / website 官网 / demo 演示 / other 其他 */
export const LinkType = {
  repo: 'repo',
  website: 'website',
  demo: 'demo',
  other: 'other',
} as const
export type LinkType = (typeof LinkType)[keyof typeof LinkType]

/** 项目状态（元数据）：active 进行中 / completed 已完成 / maintained 维护中 / paused 暂停 */
export const ProjectLifecycle = {
  active: 'active',
  completed: 'completed',
  maintained: 'maintained',
  paused: 'paused',
} as const
export type ProjectLifecycle = (typeof ProjectLifecycle)[keyof typeof ProjectLifecycle]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已下架',
}

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  repo: '仓库',
  website: '官网',
  demo: '演示',
  other: '其他',
}

export const PROJECT_LIFECYCLE_LABELS: Record<ProjectLifecycle, string> = {
  active: '进行中',
  completed: '已完成',
  maintained: '维护中',
  paused: '暂停',
}
