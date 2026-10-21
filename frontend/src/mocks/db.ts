/**
 * mock 内存数据库：实现契约的数据语义（软删除、1:1 笔记、技术栈按名 upsert、
 * 级联规则）。仅用于开发（VITE_USE_MOCK）与测试，不进入生产构建。
 */
import type {
  AdminProjectDetail,
  AdminProjectListItem,
  Link,
  LinkCreate,
  LinkUpdate,
  ListEnvelope,
  Note,
  NoteUpsert,
  PaginationMeta,
  ProjectCreate,
  ProjectDetail,
  ProjectListItem,
  ProjectStatus,
  ProjectUpdate,
} from '@/types'

export interface DbProject {
  id: string
  name: string
  tagline: string | null
  description: string | null
  status: ProjectListItem['status']
  stars: number | null
  lastActivityAt: string | null
  coverImage: string | null
  role: string | null
  projectStatus: ProjectDetail['projectStatus']
  startDate: string | null
  endDate: string | null
  githubRepo: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  technologyIds: string[]
}

export interface DbLink {
  id: string
  projectId: string
  type: Link['type']
  label: string | null
  url: string
  sortOrder: number
  createdAt: string
}

export interface DbNote {
  id: string
  projectId: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface DbTechnology {
  id: string
  name: string
}

export interface DbState {
  projects: DbProject[]
  links: DbLink[]
  notes: DbNote[]
  technologies: DbTechnology[]
  seq: number
}

let counter = 0
export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`
}

function iso(d: Date): string {
  return d.toISOString()
}

function daysAgo(n: number): string {
  return iso(new Date(Date.now() - n * 86_400_000))
}

export function createDbState(): DbState {
  const now = new Date()
  const createdAt = iso(now)

  const tech = (name: string, state: DbState): string => {
    let t = state.technologies.find((x) => x.name === name)
    if (!t) {
      t = { id: uid('tech'), name }
      state.technologies.push(t)
    }
    return t.id
  }

  const state: DbState = {
    projects: [],
    links: [],
    notes: [],
    technologies: [],
    seq: 0,
  }

  const mkProject = (
    p: Partial<DbProject> & Pick<DbProject, 'name'> & { techNames?: string[] },
  ): DbProject => {
    const id = p.id ?? uid('prj')
    const techIds = (p.techNames ?? []).map((n) => tech(n, state))
    const row: DbProject = {
      id,
      name: p.name,
      tagline: p.tagline ?? null,
      description: p.description ?? null,
      status: p.status ?? 'draft',
      stars: p.stars ?? null,
      lastActivityAt: p.lastActivityAt ?? null,
      coverImage: p.coverImage ?? null,
      role: p.role ?? null,
      projectStatus: p.projectStatus ?? null,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      githubRepo: p.githubRepo ?? null,
      deletedAt: p.deletedAt ?? null,
      createdAt: p.createdAt ?? createdAt,
      updatedAt: p.updatedAt ?? createdAt,
      technologyIds: techIds,
    }
    state.projects.push(row)
    return row
  }

  const mkLink = (
    projectId: string,
    l: { type?: Link['type']; label?: string | null; url: string; sortOrder?: number },
  ): DbLink => {
    const row: DbLink = {
      id: uid('link'),
      projectId,
      type: l.type ?? 'other',
      label: l.label ?? null,
      url: l.url,
      sortOrder: l.sortOrder ?? 0,
      createdAt,
    }
    state.links.push(row)
    return row
  }

  const mkNote = (
    projectId: string,
    n: { title: string; content: string },
  ): DbNote => {
    const row: DbNote = {
      id: uid('note'),
      projectId,
      title: n.title,
      content: n.content,
      createdAt,
      updatedAt: createdAt,
    }
    state.notes.push(row)
    return row
  }

  // 种子数据：覆盖三种发布状态 + 完整字段形态，便于开发/演示。
  const portfolio = mkProject({
    name: 'multica-demo',
    tagline: '项目展示平台：记录我做过的项目、笔记与元数据',
    description: '一个个人项目展示平台，分前台与后台。\n\n- 后台：登录、项目 CRUD、元数据/链接/笔记管理\n- 前台：项目列表与详情、笔记阅读',
    status: 'published',
    stars: 12,
    lastActivityAt: daysAgo(1),
    role: '全栈开发',
    projectStatus: 'active',
    startDate: daysAgo(120),
    endDate: null,
    githubRepo: 'jsonbug/multica-demo',
    techNames: ['Vue', 'Node.js', 'TypeScript'],
  })
  mkLink(portfolio.id, { type: 'repo', label: 'GitHub 仓库', url: 'https://github.com/jsonbug/multica-demo', sortOrder: 0 })
  mkLink(portfolio.id, { type: 'website', label: '官网', url: 'https://example.com', sortOrder: 1 })
  mkNote(portfolio.id, {
    title: 'multica-demo 开发笔记',
    content: '# 项目展示平台\n\n记录开发过程中的关键决策。\n\n- 技术栈：Vue 3 + Node.js\n- 数据库：SQLite（预留迁 PostgreSQL）',
  })

  mkProject({
    name: 'chart-kit',
    tagline: '轻量图表库',
    description: '一个无依赖的 SVG 图表库。',
    status: 'draft',
    stars: 0,
    role: '维护者',
    projectStatus: 'maintained',
    startDate: daysAgo(300),
    githubRepo: 'jsonbug/chart-kit',
    techNames: ['TypeScript'],
  })

  mkProject({
    name: 'old-crawler',
    tagline: '已归档的爬虫项目',
    status: 'archived',
    stars: 5,
    projectStatus: 'paused',
    startDate: daysAgo(500),
    endDate: daysAgo(200),
    techNames: ['Python'],
  })

  return state
}

function techName(state: DbState, id: string): string {
  return state.technologies.find((t) => t.id === id)?.name ?? id
}

function toListItem(state: DbState, p: DbProject): ProjectListItem {
  return {
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    status: p.status,
    stars: p.stars,
    lastActivityAt: p.lastActivityAt,
    coverImage: p.coverImage,
    technologies: p.technologyIds.map((id) => techName(state, id)),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

function toAdminListItem(state: DbState, p: DbProject): AdminProjectListItem {
  return { ...toListItem(state, p), deletedAt: p.deletedAt }
}

function toDetail(state: DbState, p: DbProject): ProjectDetail {
  const links = state.links
    .filter((l) => l.projectId === p.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .map((l): Link => ({ id: l.id, type: l.type, label: l.label, url: l.url, sortOrder: l.sortOrder, createdAt: l.createdAt }))
  const note = state.notes.find((n) => n.projectId === p.id)
  return {
    ...toListItem(state, p),
    description: p.description,
    role: p.role,
    projectStatus: p.projectStatus,
    startDate: p.startDate,
    endDate: p.endDate,
    githubRepo: p.githubRepo,
    links,
    note: note
      ? { id: note.id, title: note.title, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt }
      : null,
  }
}

function toAdminDetail(state: DbState, p: DbProject): AdminProjectDetail {
  return { ...toDetail(state, p), deletedAt: p.deletedAt }
}

function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; meta: PaginationMeta } {
  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const p = Math.max(1, page)
  const start = (p - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    meta: { page: p, pageSize, total, totalPages },
  }
}

export interface ListQuery {
  page: number
  pageSize: number
}

/** 后台项目列表（含草稿/下架；includeDeleted 时含已删除）。 */
export function adminListProjects(
  state: DbState,
  q: ListQuery & { includeDeleted?: boolean; status?: string; search?: string },
): ListEnvelope<AdminProjectListItem> {
  let rows = state.projects
  if (!q.includeDeleted) rows = rows.filter((p) => p.deletedAt === null)
  if (q.status) rows = rows.filter((p) => p.status === q.status)
  if (q.search) {
    const s = q.search.toLowerCase()
    rows = rows.filter((p) => p.name.toLowerCase().includes(s) || (p.tagline ?? '').toLowerCase().includes(s))
  }
  rows = rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const { items, meta } = paginate(rows, q.page, q.pageSize)
  return { items: items.map((p) => toAdminListItem(state, p)), ...meta }
}

/** 前台项目列表：仅 status=published 且未软删除。 */
export function publicListProjects(
  state: DbState,
  q: ListQuery & { search?: string; technology?: string },
): ListEnvelope<ProjectListItem> {
  let rows = state.projects.filter((p) => p.deletedAt === null && p.status === 'published')
  if (q.search) {
    const s = q.search.toLowerCase()
    rows = rows.filter((p) => p.name.toLowerCase().includes(s) || (p.tagline ?? '').toLowerCase().includes(s))
  }
  if (q.technology) {
    rows = rows.filter((p) => p.technologyIds.some((id) => techName(state, id) === q.technology))
  }
  rows = rows.slice().sort((a, b) => {
    const ka = a.lastActivityAt ?? a.updatedAt
    const kb = b.lastActivityAt ?? b.updatedAt
    return kb.localeCompare(ka)
  })
  const { items, meta } = paginate(rows, q.page, q.pageSize)
  return { items: items.map((p) => toListItem(state, p)), ...meta }
}

export function getProject(state: DbState, id: string): DbProject | undefined {
  return state.projects.find((p) => p.id === id)
}

/** 发布/下架状态机（契约 §3.3 冻结）：仅允许两跳，同状态 no-op。 */
const STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ['published'],
  published: ['archived'],
  archived: ['published'],
}

/** 判断 status 迁移是否合法（同状态 no-op 视为合法）。 */
export function canTransitionStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true
  return (STATUS_TRANSITIONS[from] ?? []).includes(to)
}

export function getProjectDetail(state: DbState, id: string): ProjectDetail | undefined {
  const p = getProject(state, id)
  return p ? toDetail(state, p) : undefined
}

export function getAdminProjectDetail(state: DbState, id: string): AdminProjectDetail | undefined {
  const p = getProject(state, id)
  return p ? toAdminDetail(state, p) : undefined
}

function upsertTechnologyIds(state: DbState, names: string[]): string[] {
  return names.map((name) => {
    const trimmed = name.trim()
    let t = state.technologies.find((x) => x.name === trimmed)
    if (!t) {
      t = { id: uid('tech'), name: trimmed }
      state.technologies.push(t)
    }
    return t.id
  })
}

function applyProjectPatch(state: DbState, p: DbProject, input: ProjectUpdate): void {
  if (input.name !== undefined) p.name = input.name
  if (input.tagline !== undefined) p.tagline = input.tagline
  if (input.description !== undefined) p.description = input.description
  if (input.status !== undefined) p.status = input.status
  if (input.stars !== undefined) p.stars = input.stars
  if (input.lastActivityAt !== undefined) p.lastActivityAt = input.lastActivityAt
  if (input.role !== undefined) p.role = input.role
  if (input.projectStatus !== undefined) p.projectStatus = input.projectStatus
  if (input.startDate !== undefined) p.startDate = input.startDate
  if (input.endDate !== undefined) p.endDate = input.endDate
  if (input.githubRepo !== undefined) p.githubRepo = input.githubRepo
  if (input.coverImage !== undefined) p.coverImage = input.coverImage
  if (input.technologies !== undefined) p.technologyIds = upsertTechnologyIds(state, input.technologies)
  p.updatedAt = iso(new Date())
}

export function createProject(state: DbState, input: ProjectCreate): AdminProjectDetail {
  const row: DbProject = {
    id: uid('prj'),
    name: input.name,
    tagline: input.tagline ?? null,
    description: input.description ?? null,
    status: input.status ?? 'draft',
    stars: input.stars ?? null,
    lastActivityAt: input.lastActivityAt ?? null,
    coverImage: input.coverImage ?? null,
    role: input.role ?? null,
    projectStatus: input.projectStatus ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    githubRepo: input.githubRepo ?? null,
    deletedAt: null,
    createdAt: iso(new Date()),
    updatedAt: iso(new Date()),
    technologyIds: upsertTechnologyIds(state, input.technologies ?? []),
  }
  state.projects.push(row)
  return toAdminDetail(state, row)
}

/** updateProject 结果：区分「非法迁移 400」与「不存在 404」。 */
export type UpdateProjectResult =
  | { ok: true; detail: AdminProjectDetail }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_STATUS_TRANSITION' }

export function updateProject(state: DbState, id: string, input: ProjectUpdate): UpdateProjectResult {
  const p = getProject(state, id)
  if (!p) return { ok: false, reason: 'NOT_FOUND' }
  if (input.status !== undefined && !canTransitionStatus(p.status, input.status)) {
    return { ok: false, reason: 'INVALID_STATUS_TRANSITION' }
  }
  applyProjectPatch(state, p, input)
  return { ok: true, detail: toAdminDetail(state, p) }
}

export function softDeleteProject(state: DbState, id: string): boolean {
  const p = getProject(state, id)
  if (!p) return false
  p.deletedAt = iso(new Date())
  p.updatedAt = p.deletedAt
  return true
}

export function restoreProject(state: DbState, id: string): AdminProjectDetail | undefined {
  const p = getProject(state, id)
  if (!p) return undefined
  p.deletedAt = null
  p.updatedAt = iso(new Date())
  return toAdminDetail(state, p)
}

export function listTechnologies(state: DbState): string[] {
  return state.technologies.map((t) => t.name).sort((a, b) => a.localeCompare(b))
}

export function upsertNote(state: DbState, projectId: string, input: NoteUpsert): Note | undefined {
  if (!getProject(state, projectId)) return undefined
  let note = state.notes.find((n) => n.projectId === projectId)
  const now = iso(new Date())
  if (note) {
    note.title = input.title
    note.content = input.content
    note.updatedAt = now
  } else {
    note = { id: uid('note'), projectId, title: input.title, content: input.content, createdAt: now, updatedAt: now }
    state.notes.push(note)
  }
  return { id: note.id, title: note.title, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt }
}

export function deleteNote(state: DbState, projectId: string): boolean {
  if (!getProject(state, projectId)) return false
  const idx = state.notes.findIndex((n) => n.projectId === projectId)
  if (idx !== -1) state.notes.splice(idx, 1)
  return true
}

export function addLink(state: DbState, projectId: string, input: LinkCreate): Link | undefined {
  if (!getProject(state, projectId)) return undefined
  const now = iso(new Date())
  const row: DbLink = {
    id: uid('link'),
    projectId,
    type: input.type ?? 'other',
    label: input.label ?? null,
    url: input.url,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
  }
  state.links.push(row)
  return { id: row.id, type: row.type, label: row.label, url: row.url, sortOrder: row.sortOrder, createdAt: row.createdAt }
}

export function getLink(state: DbState, id: string): DbLink | undefined {
  return state.links.find((l) => l.id === id)
}

export function updateLink(state: DbState, id: string, input: LinkUpdate): Link | undefined {
  const l = getLink(state, id)
  if (!l) return undefined
  if (input.type !== undefined) l.type = input.type
  if (input.label !== undefined) l.label = input.label
  if (input.url !== undefined) l.url = input.url
  if (input.sortOrder !== undefined) l.sortOrder = input.sortOrder
  return { id: l.id, type: l.type, label: l.label, url: l.url, sortOrder: l.sortOrder, createdAt: l.createdAt }
}

export function deleteLink(state: DbState, id: string): boolean {
  const idx = state.links.findIndex((l) => l.id === id)
  if (idx === -1) return false
  state.links.splice(idx, 1)
  return true
}
