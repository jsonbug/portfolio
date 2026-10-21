/**
 * Mock 数据库：契约 v1.2 的内存实现（snake_case、slug + 301、笔记 N:1、元数据 KV）。
 *
 * 与后端共用同一份契约（`docs/api-contract.md`），因此这里不是「随便编的假数据」，
 * 而是把接口语义（可见性、分段计数、排序、状态机、slug 别名）在内存里实现一遍，
 * 前端可以在没有后端的情况下写完并测完业务逻辑。
 *
 * 约定：
 * - 种子数据覆盖所有分支：published/draft/archived、软删除、无封面、无 summary、
 *   stars 为 null、多篇笔记（含草稿）、多类型链接、旧 slug 别名。
 * - 时间用 ISO 字符串，种子时间相对 `createDbState(now)` 的 `now` 生成，测试可注入固定时间。
 */
import type {
  AdminNoteDetail,
  AdminNoteListItem,
  AdminNoteSummary,
  AdminProjectListCounts,
  AdminProjectListEnvelope,
  AdminProjectDetail,
  AdminProjectListItem,
  AdminNoteQuery,
  Link,
  LinkStatus,
  LinkType,
  ListEnvelope,
  MetadataItem,
  NoteDetail,
  NotePublishStatus,
  NoteSummary,
  Progress,
  ProjectDetail,
  ProjectListItem,
  ProjectListEnvelope,
  ProjectSort,
  PublishStatus,
} from '@/types'
import { MAX_SEARCH_LENGTH } from '@/utils/text'

const DAY = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString()

/** 生成带前缀的 id（仅供 mock 使用，真实 id 由后端生成）。 */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export interface DbProject {
  id: string
  slug: string
  name: string
  summary: string | null
  description_md: string | null
  cover_image_url: string | null
  cover_source_url: string | null
  publish_status: PublishStatus
  progress: Progress
  stars: number | null
  version: string | null
  last_updated_at: string | null
  role: string | null
  license: string | null
  start_year: number | null
  team_size: number | null
  tech_stack: string[]
  published_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface DbLink {
  id: string
  project_id: string
  type: LinkType
  label: string | null
  url: string
  sort: number
  /** 库里 null = 从未检查；wire 上由 toLink 转成 'unknown'。 */
  last_status: LinkStatus | null
  last_http_status: number | null
  last_checked_at: string | null
  created_at: string
}

export interface DbMetadata {
  id: string
  project_id: string
  key_label: string
  value: string
  sort: number
}

export interface DbNote {
  id: string
  project_id: string
  slug: string
  title: string
  body_md: string
  publish_status: NotePublishStatus
  tags: string[]
  published_at: string | null
  created_at: string
  updated_at: string
}

/** 旧 slug 映射：改名后旧地址 301 到归属资源。 */
export interface DbSlugAlias {
  entity_type: 'project' | 'note'
  slug: string
  target_id: string
  created_at: string
}

export interface DbState {
  projects: DbProject[]
  links: DbLink[]
  metadata: DbMetadata[]
  notes: DbNote[]
  aliases: DbSlugAlias[]
  /** 种子数据的「现在」，写入操作的时间基准（测试可注入固定值）。 */
  now: number
}

// ---------------------------------------------------------------- 种子数据

interface SeedProject extends Partial<Omit<DbProject, 'slug' | 'name' | 'publish_status' | 'progress'>> {
  slug: string
  name: string
  publish_status: PublishStatus
  progress: Progress
  /** 种子专用：创建时间相对 now 的天数。 */
  createdDaysAgo?: number
}

function seedProject(now: number, seed: SeedProject): DbProject {
  const created = iso(now - (seed.createdDaysAgo ?? 120) * DAY)
  return {
    id: seed.id ?? uid('proj'),
    slug: seed.slug,
    name: seed.name,
    summary: seed.summary ?? null,
    description_md: seed.description_md ?? null,
    cover_image_url: seed.cover_image_url ?? null,
    cover_source_url: seed.cover_source_url ?? null,
    publish_status: seed.publish_status,
    progress: seed.progress,
    stars: seed.stars ?? null,
    version: seed.version ?? null,
    last_updated_at: seed.last_updated_at ?? null,
    role: seed.role ?? null,
    license: seed.license ?? null,
    start_year: seed.start_year ?? null,
    team_size: seed.team_size ?? null,
    tech_stack: seed.tech_stack ? [...seed.tech_stack] : [],
    published_at:
      seed.published_at ?? (seed.publish_status === 'published' || seed.publish_status === 'archived'
        ? iso(now - 60 * DAY)
        : null),
    deleted_at: seed.deleted_at ?? null,
    created_at: created,
    updated_at: seed.updated_at ?? iso(now - 2 * DAY),
  }
}

/** 种子里的项目 id 固定，便于测试与别名引用。 */
export const SEED_IDS = {
  portfolio: 'proj_portfolio',
  chart: 'proj_chart',
  crawler: 'proj_crawler',
  oldBlog: 'proj_old_blog',
  draft: 'proj_draft_idea',
  deleted: 'proj_deleted_tool',
} as const

/**
 * 建一份与真实后端形态一致的种子库。
 * 覆盖：已发布进行中 / 已发布已上线 / 无封面 / 无 summary / stars=null /
 * 草稿 / 已归档 / 软删除 / 多类型链接 / 多篇笔记（含草稿）/ 旧 slug 别名。
 */
export function createDbState(now = Date.now()): DbState {
  const projects: DbProject[] = [
    seedProject(now, {
      id: SEED_IDS.portfolio,
      slug: 'portfolio-platform',
      tech_stack: ['Vue 3', 'TypeScript', 'Vite', 'Fastify'],
      name: '项目展示平台',
      summary: '把散落在收藏夹里的项目收进一个可检索、可记笔记的展示站。',
      description_md: '## 目标\n\n一页看清每个项目的进展、技术栈与链接。\n\n- 前台：列表、分段、搜索\n- 后台：元数据与笔记维护',
      cover_image_url: 'https://images.example.com/covers/portfolio.webp',
      cover_source_url: 'https://images.example.com/source/portfolio.png',
      publish_status: 'published',
      progress: 'ongoing',
      stars: 128,
      version: '1.4.0',
      last_updated_at: iso(now - 2 * DAY),
      role: '前端负责人',
      license: 'MIT',
      start_year: 2024,
      team_size: 2,
      createdDaysAgo: 180,
      updated_at: iso(now - 2 * DAY),
    }),
    seedProject(now, {
      id: SEED_IDS.chart,
      slug: 'chart-kit',
      tech_stack: ['TypeScript', 'SVG', 'Rollup'],
      name: 'Chart Kit',
      summary: '声明式图表库，包体 30KB 以内，支持 SSR 与主题变量。',
      description_md: '# Chart Kit\n\n用声明式 schema 渲染折线 / 柱状 / 面积图。',
      publish_status: 'published',
      progress: 'launched',
      stars: 864,
      version: '0.9.2',
      last_updated_at: iso(now - 40 * DAY),
      role: '维护者',
      license: 'MIT',
      start_year: 2022,
      team_size: 1,
      createdDaysAgo: 900,
      updated_at: iso(now - 40 * DAY),
    }),
    seedProject(now, {
      id: SEED_IDS.crawler,
      slug: 'crawler-tools',
      tech_stack: ['Python', 'asyncio'],
      name: '抓取工具箱',
      summary: null,
      description_md: null,
      cover_image_url: 'https://images.example.com/covers/crawler.webp',
      publish_status: 'published',
      progress: 'ongoing',
      stars: 12,
      version: '0.3.1',
      last_updated_at: iso(now - 7 * DAY),
      role: '独立开发',
      license: 'Apache-2.0',
      start_year: 2023,
      team_size: null,
      createdDaysAgo: 300,
      updated_at: iso(now - 7 * DAY),
    }),
    seedProject(now, {
      id: SEED_IDS.oldBlog,
      slug: 'old-blog',
      tech_stack: ['Hugo', 'Nginx'],
      name: '旧博客',
      summary: '已经停止维护的静态博客，只留作纪念。',
      publish_status: 'archived',
      progress: 'launched',
      stars: null,
      last_updated_at: iso(now - 400 * DAY),
      createdDaysAgo: 1500,
      updated_at: iso(now - 400 * DAY),
    }),
    seedProject(now, {
      id: SEED_IDS.draft,
      slug: 'draft-idea',
      tech_stack: ['Rust'],
      name: '还没想好的东西',
      summary: '草稿不该出现在任何前台列表里。',
      publish_status: 'draft',
      progress: 'ongoing',
      createdDaysAgo: 10,
      updated_at: iso(now - 1 * DAY),
    }),
    seedProject(now, {
      id: SEED_IDS.deleted,
      slug: 'deleted-tool',
      tech_stack: ['Go'],
      name: '被软删的工具',
      summary: '软删除后前台 404，后台默认列表也看不到。',
      publish_status: 'published',
      progress: 'ongoing',
      stars: 3,
      deleted_at: iso(now - 5 * DAY),
      createdDaysAgo: 200,
      updated_at: iso(now - 5 * DAY),
    }),
  ]

  const link = (
    projectId: string,
    type: LinkType,
    url: string,
    sort: number,
    label: string | null = null,
    health: { last_status: LinkStatus | null; last_http_status: number | null } = {
      last_status: null,
      last_http_status: null,
    },
  ): DbLink => ({
    id: uid('link'),
    project_id: projectId,
    type,
    label,
    url,
    sort,
    last_status: health.last_status,
    last_http_status: health.last_http_status,
    last_checked_at: health.last_status === null ? null : iso(now - 2 * DAY),
    created_at: iso(now - 30 * DAY),
  })

  const links: DbLink[] = [
    link(SEED_IDS.portfolio, 'repo', 'https://github.com/jsonbug/portfolio', 0, 'GitHub'),
    link(SEED_IDS.portfolio, 'site', 'https://portfolio.example.com', 1, '官网'),
    link(SEED_IDS.chart, 'repo', 'https://github.com/jsonbug/chart-kit', 0, 'GitHub'),
    // 失效态挂在 site 上：后台「链接」列只渲染 repo/site 两类，评审要求失效态在那一列可验
    link(SEED_IDS.chart, 'site', 'https://chart.example.com', 1, null, {
      last_status: 'failed',
      last_http_status: 502,
    }),
    link(SEED_IDS.chart, 'docs', 'https://chart.example.com/docs', 2, '文档', {
      last_status: 'failed',
      last_http_status: 502,
    }),
    link(SEED_IDS.crawler, 'repo', 'https://github.com/jsonbug/crawler-tools', 0, null),
    link(SEED_IDS.oldBlog, 'site', 'https://blog.example.com', 0, null),
    link(SEED_IDS.deleted, 'repo', 'https://github.com/jsonbug/deleted-tool', 0, null),
  ]

  const metadata: DbMetadata[] = [
    { id: uid('meta'), project_id: SEED_IDS.portfolio, key_label: '代码行数', value: '18k', sort: 0 },
    { id: uid('meta'), project_id: SEED_IDS.portfolio, key_label: '测试用例', value: '76', sort: 1 },
    { id: uid('meta'), project_id: SEED_IDS.chart, key_label: '包体', value: '28KB', sort: 0 },
  ]

  const note = (
    projectId: string,
    slug: string,
    title: string,
    body_md: string,
    publishStatus: NotePublishStatus,
    tags: string[],
    publishedDaysAgo: number | null,
  ): DbNote => ({
    id: uid('note'),
    project_id: projectId,
    slug,
    title,
    body_md,
    publish_status: publishStatus,
    tags,
    published_at: publishedDaysAgo === null ? null : iso(now - publishedDaysAgo * DAY),
    created_at: iso(now - ((publishedDaysAgo ?? 5) + 2) * DAY),
    updated_at: iso(now - (publishedDaysAgo ?? 1) * DAY),
  })

  const notes: DbNote[] = [
    note(
      SEED_IDS.portfolio,
      'why-mock-first',
      '为什么先做 mock-first 联调',
      '后端还没落地时，前端用同一份契约的 mock 跑通全部交互，联调期只换开关。',
      'published',
      ['工程', '测试'],
      10,
    ),
    note(
      SEED_IDS.portfolio,
      'v1-2-notes',
      'v1.2 改造笔记',
      '曝光状态与进展拆成两个字段，前台分段因此只依赖 `progress`。',
      'published',
      ['决策'],
      3,
    ),
    note(
      SEED_IDS.portfolio,
      'draft-outline',
      '（草稿）下一轮想做的事',
      '写完再发。',
      'draft',
      [],
      null,
    ),
    note(
      SEED_IDS.chart,
      'chart-kit-0-9',
      'Chart Kit 0.9 发布说明',
      '新增面积图与 SSR 支持，包体再减 6KB。',
      'published',
      ['发布'],
      40,
    ),
    note(SEED_IDS.oldBlog, 'archived-note', '归档项目下的笔记', '所属项目归档后，前台不应看到这条。', 'published', [], 200),
  ]

  // portfolio-platform 曾用 slug：multica-demo → 旧地址 301
  const aliases: DbSlugAlias[] = [
    {
      entity_type: 'project',
      slug: 'multica-demo',
      target_id: SEED_IDS.portfolio,
      created_at: iso(now - 90 * DAY),
    },
    {
      entity_type: 'note',
      slug: 'v1-2-notes-old',
      target_id: notes[1].id,
      created_at: iso(now - 20 * DAY),
    },
  ]

  return { projects, links, metadata, notes, aliases, now }
}

// ---------------------------------------------------------------- 序列化

export function linksOf(state: DbState, projectId: string): DbLink[] {
  return state.links
    .filter((l) => l.project_id === projectId)
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at))
}

export function toLink(l: DbLink): Link {
  return {
    id: l.id,
    type: l.type,
    label: l.label,
    url: l.url,
    sort: l.sort,
    // 契约：库里 null = 从未检查，wire 上统一是 'unknown'（前端不处理 null）。
    last_status: l.last_status ?? 'unknown',
    last_http_status: l.last_http_status,
    last_checked_at: l.last_checked_at,
    created_at: l.created_at,
  }
}

export function isProjectVisible(p: DbProject): boolean {
  return p.publish_status === 'published' && p.deleted_at === null
}

export function isNoteVisible(state: DbState, n: DbNote): boolean {
  if (n.publish_status !== 'published') return false
  const project = state.projects.find((p) => p.id === n.project_id)
  return !!project && isProjectVisible(project)
}

export function toProjectListItem(state: DbState, p: DbProject): ProjectListItem {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    cover_image_url: p.cover_image_url,
    progress: p.progress,
    stars: p.stars,
    version: p.version,
    last_updated_at: p.last_updated_at,
    tech_stack: [...p.tech_stack],
    links: linksOf(state, p.id).map(toLink),
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

/**
 * 笔记摘要（契约 v1.2.3）：去 Markdown 标记后取前 120 字，超长补省略号，空正文为 null。
 * 后端同口径实现，联调时逐字比对。
 */
export function excerptOf(bodyMd: string | null | undefined): string | null {
  if (!bodyMd) return null
  const plain = bodyMd
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`([^`]*)`/g, '$1') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保文字
    .replace(/<[^>]+>/g, ' ') // 内联 HTML（与后端 serialize.excerptOf 保持一致）
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, ' ') // 标题/引用/列表标记
    .replace(/[*_~]/g, '') // 强调
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return null
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain
}

export function toNoteSummary(state: DbState, n: DbNote): NoteSummary {
  const project = state.projects.find((p) => p.id === n.project_id)
  return {
    id: n.id,
    slug: n.slug,
    title: n.title,
    excerpt: excerptOf(n.body_md),
    project: { slug: project?.slug ?? '', name: project?.name ?? '' },
    tags: [...n.tags],
    published_at: n.published_at,
    created_at: n.created_at,
    updated_at: n.updated_at,
  }
}

export function toNoteDetail(state: DbState, n: DbNote): NoteDetail {
  return { ...toNoteSummary(state, n), body_md: n.body_md }
}

/** 笔记排序键：published_at 缺失时回退 created_at（契约 3.3）。 */
function noteRecency(n: DbNote): string {
  return n.published_at ?? n.created_at
}

function publishedNotesOf(state: DbState, projectId: string): NoteSummary[] {
  return state.notes
    .filter((n) => n.project_id === projectId && n.publish_status === 'published')
    .sort((a, b) => noteRecency(b).localeCompare(noteRecency(a)))
    .map((n) => toNoteSummary(state, n))
}

/** 后台项目详情里的笔记：全部（含草稿），逐条带曝光状态。 */
function adminNotesOf(state: DbState, projectId: string): AdminNoteSummary[] {
  return state.notes
    .filter((n) => n.project_id === projectId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((n) => toAdminNoteSummary(state, n))
}

export function toAdminNoteSummary(state: DbState, n: DbNote): AdminNoteSummary {
  return { ...toNoteSummary(state, n), publish_status: n.publish_status }
}

function metadataOf(state: DbState, projectId: string): MetadataItem[] {
  return state.metadata
    .filter((m) => m.project_id === projectId)
    .sort((a, b) => a.sort - b.sort)
    .map((m) => ({ key_label: m.key_label, value: m.value, sort: m.sort }))
}

export function toProjectDetail(
  state: DbState,
  p: DbProject,
  options: { includeDraftNotes?: boolean } = {},
): ProjectDetail {
  const notes = options.includeDraftNotes
    ? adminNotesOf(state, p.id)
    : publishedNotesOf(state, p.id)

  return {
    ...toProjectListItem(state, p),
    description_md: p.description_md,
    role: p.role,
    license: p.license,
    start_year: p.start_year,
    team_size: p.team_size,
    metadata: metadataOf(state, p.id),
    notes,
  }
}

export function toAdminProjectListItem(state: DbState, p: DbProject): AdminProjectListItem {
  return {
    ...toProjectListItem(state, p),
    publish_status: p.publish_status,
    published_at: p.published_at,
    deleted_at: p.deleted_at,
    // 口径与真后端一致：该项目全部笔记（草稿 + 已发布），与过滤条件无关。
    note_count: state.notes.filter((note) => note.project_id === p.id).length,
  }
}

export function toAdminProjectDetail(state: DbState, p: DbProject): AdminProjectDetail {
  return {
    ...toProjectDetail(state, p),
    // 后台详情要看到草稿笔记，且每条带 publish_status（契约 4.1）。
    notes: adminNotesOf(state, p.id),
    publish_status: p.publish_status,
    published_at: p.published_at,
    cover_source_url: p.cover_source_url,
    deleted_at: p.deleted_at,
  }
}

export function toAdminNoteListItem(state: DbState, n: DbNote): AdminNoteListItem {
  return {
    ...toNoteSummary(state, n),
    publish_status: n.publish_status,
    project_id: n.project_id,
  }
}

export function toAdminNoteDetail(state: DbState, n: DbNote): AdminNoteDetail {
  return { ...toAdminNoteListItem(state, n), body_md: n.body_md }
}

// ---------------------------------------------------------------- 查询

function matches(haystacks: Array<string | null | undefined>, search: string): boolean {
  // 与前端 clampSearch 同口径：search 参数上限 200 字（契约 v1.2）。
  const q = search.trim().slice(0, MAX_SEARCH_LENGTH).toLowerCase()
  if (!q) return true
  return haystacks.some((h) => !!h && h.toLowerCase().includes(q))
}

function paginate<T>(items: T[], page = 1, pageSize = 20): ListEnvelope<T> {
  const size = Math.min(Math.max(Math.trunc(pageSize) || 20, 1), 100)
  const current = Math.max(Math.trunc(page) || 1, 1)
  const total = items.length
  const start = (current - 1) * size
  return {
    items: items.slice(start, start + size),
    page: current,
    pageSize: size,
    total,
    totalPages: size > 0 ? Math.ceil(total / size) : 0,
  }
}

/** `recent` 排序键：`last_updated_at` 为空回退系统 `updated_at`。 */
/** 技术栈写入去重（保留首次出现顺序）。 */
export function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function recentKey(p: DbProject): string {
  return p.last_updated_at ?? p.updated_at
}

export interface PublicProjectListParams {
  search?: string
  technology?: string[]
  progress?: Progress
  sort?: ProjectSort
  page?: number
  pageSize?: number
}

/**
 * 前台项目列表：可见性 → search → technology(任一命中) → counts → progress → sort → 分页。
 * `counts` 在 progress 过滤前统计（契约 3.1）。
 */
export function listPublicProjects(
  state: DbState,
  params: PublicProjectListParams = {},
): ProjectListEnvelope {
  const { search = '', technology = [], progress, sort = 'recent', page = 1, pageSize = 20 } = params
  // 契约 3.1：技术栈精确匹配、大小写敏感（`Vue` 与 `vue` 是两条不同记录）。
  const techs = technology.map((t) => t.trim()).filter(Boolean)

  const visible = state.projects.filter(isProjectVisible)
  const searched = visible.filter((p) => matches([p.name, p.summary], search))
  const byTech = techs.length ? searched.filter((p) => p.tech_stack.some((t) => techs.includes(t))) : searched

  const counts = {
    all: byTech.length,
    ongoing: byTech.filter((p) => p.progress === 'ongoing').length,
    launched: byTech.filter((p) => p.progress === 'launched').length,
  }

  const segmented = progress ? byTech.filter((p) => p.progress === progress) : byTech
  const sorted = [...segmented].sort((a, b) => {
    if (sort === 'stars') {
      // 契约 3.1：stars 为 null 排在最后（兜底 -1，同分回 recent）。
      const diff = (b.stars ?? -1) - (a.stars ?? -1)
      if (diff !== 0) return diff
    }
    return recentKey(b).localeCompare(recentKey(a))
  })

  const envelope = paginate(sorted, page, pageSize)
  return { ...envelope, items: envelope.items.map((p) => toProjectListItem(state, p)), counts }
}

export interface AdminProjectListParams {
  publish_status?: PublishStatus
  progress?: Progress
  search?: string
  includeDeleted?: boolean
  page?: number
  pageSize?: number
}

export function listAdminProjects(
  state: DbState,
  params: AdminProjectListParams = {},
): AdminProjectListEnvelope {
  const { publish_status, progress, search = '', includeDeleted = false, page = 1, pageSize = 20 } = params
  // counts：search + includeDeleted 过滤后、publish_status / progress 过滤前（契约 4.1）。
  const scoped = state.projects
    .filter((p) => (includeDeleted ? true : p.deleted_at === null))
    .filter((p) => matches([p.name, p.summary, p.slug], search))

  const counts: AdminProjectListCounts = {
    all: scoped.length,
    draft: scoped.filter((p) => p.publish_status === 'draft').length,
    published: scoped.filter((p) => p.publish_status === 'published').length,
    archived: scoped.filter((p) => p.publish_status === 'archived').length,
  }

  const rows = scoped
    .filter((p) => (publish_status ? p.publish_status === publish_status : true))
    .filter((p) => (progress ? p.progress === progress : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const envelope = paginate(rows, page, pageSize)
  return { ...envelope, items: envelope.items.map((p) => toAdminProjectListItem(state, p)), counts }
}

function aliasTarget(state: DbState, entity: 'project' | 'note', slug: string): string | null {
  const alias = state.aliases.find((a) => a.entity_type === entity && a.slug === slug)
  return alias ? alias.target_id : null
}

/** 前台按 slug 找项目：直接命中优先，其次解析旧 slug 别名（目标须可见）。 */
export function findPublicProjectBySlug(state: DbState, slug: string): DbProject | null {
  const direct = state.projects.find((p) => p.slug === slug)
  if (direct) return isProjectVisible(direct) ? direct : null
  const targetId = aliasTarget(state, 'project', slug)
  if (!targetId) return null
  const target = state.projects.find((p) => p.id === targetId)
  return target && isProjectVisible(target) ? target : null
}

/** 旧 slug 命中的目标 slug（用于发 301）；当前 slug 直接命中时返回 null。 */
export function projectRedirectTarget(state: DbState, slug: string): string | null {
  if (state.projects.some((p) => p.slug === slug)) return null
  const targetId = aliasTarget(state, 'project', slug)
  if (!targetId) return null
  const target = state.projects.find((p) => p.id === targetId)
  return target && isProjectVisible(target) ? target.slug : null
}

export function findPublicNoteBySlug(state: DbState, slug: string): DbNote | null {
  const direct = state.notes.find((n) => n.slug === slug)
  if (direct) return isNoteVisible(state, direct) ? direct : null
  const targetId = aliasTarget(state, 'note', slug)
  if (!targetId) return null
  const target = state.notes.find((n) => n.id === targetId)
  return target && isNoteVisible(state, target) ? target : null
}

export function noteRedirectTarget(state: DbState, slug: string): string | null {
  if (state.notes.some((n) => n.slug === slug)) return null
  const targetId = aliasTarget(state, 'note', slug)
  if (!targetId) return null
  const target = state.notes.find((n) => n.id === targetId)
  return target && isNoteVisible(state, target) ? target.slug : null
}

export function listPublicNotes(
  state: DbState,
  params: { search?: string; tag?: string; page?: number; pageSize?: number } = {},
): ListEnvelope<NoteSummary> {
  const { search = '', tag, page = 1, pageSize = 20 } = params
  const rows = state.notes
    .filter((n) => isNoteVisible(state, n))
    .filter((n) => matches([n.title, n.body_md], search))
    .filter((n) => (tag ? n.tags.includes(tag) : true))
    .sort((a, b) => noteRecency(b).localeCompare(noteRecency(a)))
  const envelope = paginate(rows, page, pageSize)
  return { ...envelope, items: envelope.items.map((n) => toNoteSummary(state, n)) }
}

export function listAdminNotes(
  state: DbState,
  params: AdminNoteQuery = {},
): ListEnvelope<AdminNoteListItem> {
  const { project_id, publish_status, search = '', page = 1, pageSize = 20 } = params
  const rows = state.notes
    .filter((n) => (project_id ? n.project_id === project_id : true))
    .filter((n) => (publish_status ? n.publish_status === publish_status : true))
    .filter((n) => matches([n.title, n.body_md, n.slug], search))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const envelope = paginate(rows, page, pageSize)
  return { ...envelope, items: envelope.items.map((n) => toAdminNoteListItem(state, n)) }
}

/** 技术栈汇总：只取前台可见项目，去重升序。 */
export function listTechnologies(state: DbState): string[] {
  const set = new Set<string>()
  for (const p of state.projects.filter(isProjectVisible)) {
    for (const t of p.tech_stack) set.add(t)
  }
  // 契约 3.1：按名称码点升序（默认 sort 即码点序，不用 localeCompare，避免随环境变化）。
  return [...set].sort()
}

// ---------------------------------------------------------------- 写入

export function slugTakenByProject(state: DbState, slug: string, exceptId?: string): boolean {
  return state.projects.some((p) => p.slug === slug && p.id !== exceptId)
}

export function slugTakenByNote(state: DbState, slug: string, exceptId?: string): boolean {
  return state.notes.some((n) => n.slug === slug && n.id !== exceptId)
}

export const ALLOWED_TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  draft: ['draft', 'published'],
  published: ['published', 'archived', 'draft'],
  archived: ['archived', 'published'],
}

export function canTransition(from: PublishStatus, to: PublishStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export type ProjectInput = Partial<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>> &
  Pick<DbProject, 'slug' | 'name'>

export function createProject(state: DbState, input: ProjectInput, now = state.now): DbProject {
  const project: DbProject = {
    id: uid('proj'),
    slug: input.slug,
    name: input.name,
    summary: input.summary ?? null,
    description_md: input.description_md ?? null,
    cover_image_url: input.cover_image_url ?? null,
    cover_source_url: input.cover_source_url ?? null,
    publish_status: input.publish_status ?? 'draft',
    progress: input.progress ?? 'ongoing',
    stars: input.stars ?? null,
    version: input.version ?? null,
    last_updated_at: input.last_updated_at ?? null,
    role: input.role ?? null,
    license: input.license ?? null,
    start_year: input.start_year ?? null,
    team_size: input.team_size ?? null,
    tech_stack: input.tech_stack ? dedupe(input.tech_stack) : [],
    published_at: input.publish_status === 'published' ? iso(now) : null,
    deleted_at: null,
    created_at: iso(now),
    updated_at: iso(now),
  }
  state.projects.push(project)
  if (input.tech_stack) project.tech_stack = dedupe(input.tech_stack)
  return project
}

/**
 * 局部更新：`undefined` 忽略、显式 `null` 清空；slug 改名记录旧地址别名；
 * `publish_status` 首次转 published 时写 `published_at`（之后保留首发布时间）。
 */
export function updateProject(
  state: DbState,
  project: DbProject,
  patch: Partial<Omit<DbProject, 'id' | 'created_at'>>,
  now = state.now,
): DbProject {
  const { tech_stack, ...rest } = patch as Partial<Omit<DbProject, 'id' | 'created_at'>> & {
    tech_stack?: string[]
  }

  // 契约 4.1：只有发布过的项目改名才留旧 slug 历史（草稿改名不留）。
  if (rest.slug && rest.slug !== project.slug && project.published_at !== null) {
    state.aliases.push({
      entity_type: 'project',
      slug: project.slug,
      target_id: project.id,
      created_at: iso(now),
    })
  }
  if (rest.slug) project.slug = rest.slug
  delete rest.slug

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue
    if (key === 'publish_status') {
      const next = value as PublishStatus
      if (next === 'published' && project.published_at === null) project.published_at = iso(now)
      project.publish_status = next
      continue
    }
    ;(project as unknown as Record<string, unknown>)[key] = value
  }

  if (tech_stack !== undefined) project.tech_stack = dedupe(tech_stack)
  project.updated_at = iso(now)
  return project
}

export function replaceProjectMetadata(
  state: DbState,
  projectId: string,
  items: Array<{ key_label: string; value: string }>,
): void {
  state.metadata = state.metadata.filter((m) => m.project_id !== projectId)
  items.forEach((item, index) => {
    state.metadata.push({
      id: uid('meta'),
      project_id: projectId,
      key_label: item.key_label,
      value: item.value,
      sort: index,
    })
  })
}

export function softDeleteProject(state: DbState, project: DbProject, now = state.now): DbProject {
  if (project.deleted_at === null) project.deleted_at = iso(now)
  return project
}

export function restoreProject(project: DbProject): DbProject {
  project.deleted_at = null
  return project
}

export function addLink(
  state: DbState,
  projectId: string,
  input: { type?: LinkType; label?: string | null; url: string; sort?: number },
  now = state.now,
): DbLink {
  const siblings = linksOf(state, projectId)
  const nextSort = input.sort ?? (siblings.length ? Math.max(...siblings.map((l) => l.sort)) + 1 : 0)
  const link: DbLink = {
    id: uid('link'),
    project_id: projectId,
    type: input.type ?? 'other',
    label: input.label ?? null,
    url: input.url,
    sort: nextSort,
    last_status: null,
    last_http_status: null,
    last_checked_at: null,
    created_at: iso(now),
  }
  state.links.push(link)
  return link
}

/** 模拟 `POST /admin/links/:id/check`：mock 里一律判成功（真实检查与 SSRF 防护在后端）。 */
/**
 * 同步重检一条链接（mock 版）。
 *
 * 真实后端是发一次 HEAD；mock 用 URL 里的标记决定结果，保证 `failed` 路径可测：
 * URL 命中 /fail|broken|dead/i 判失败（502），其余判成功（200）。
 */
export function checkLinkNow(state: DbState, link: DbLink): DbLink {
  const failing = /fail|broken|dead/i.test(link.url)
  link.last_status = failing ? 'failed' : 'ok'
  link.last_http_status = failing ? 502 : 200
  link.last_checked_at = iso(state.now)
  return link
}

export function patchLink(
  state: DbState,
  link: DbLink,
  patch: Partial<Pick<DbLink, 'type' | 'label' | 'url' | 'sort'>>,
): DbLink {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    ;(link as unknown as Record<string, unknown>)[key] = value
  }
  const project = state.projects.find((p) => p.id === link.project_id)
  if (project) project.updated_at = iso(state.now)
  return link
}

export function removeLink(state: DbState, link: DbLink): void {
  state.links = state.links.filter((l) => l.id !== link.id)
  const project = state.projects.find((p) => p.id === link.project_id)
  if (project) project.updated_at = iso(state.now)
}

export interface NoteInput {
  project_id: string
  slug: string
  title: string
  body_md: string
  publish_status?: NotePublishStatus
  tags?: string[]
}

export function createNote(state: DbState, input: NoteInput, now = state.now): DbNote {
  const status = input.publish_status ?? 'draft'
  const note: DbNote = {
    id: uid('note'),
    project_id: input.project_id,
    slug: input.slug,
    title: input.title,
    body_md: input.body_md,
    publish_status: status,
    tags: input.tags ? [...input.tags] : [],
    published_at: status === 'published' ? iso(now) : null,
    created_at: iso(now),
    updated_at: iso(now),
  }
  state.notes.push(note)
  return note
}

export function updateNote(
  state: DbState,
  note: DbNote,
  patch: { slug?: string; title?: string; body_md?: string; publish_status?: NotePublishStatus; tags?: string[] },
  now = state.now,
): DbNote {
  // 与项目一致：只有发布过的笔记改名才留旧 slug 历史。
  if (patch.slug && patch.slug !== note.slug && note.published_at !== null) {
    state.aliases.push({
      entity_type: 'note',
      slug: note.slug,
      target_id: note.id,
      created_at: iso(now),
    })
  }
  if (patch.slug) note.slug = patch.slug
  if (patch.title !== undefined) note.title = patch.title
  if (patch.body_md !== undefined) note.body_md = patch.body_md
  if (patch.tags !== undefined) note.tags = [...patch.tags]
  if (patch.publish_status !== undefined) {
    if (patch.publish_status === 'published' && note.published_at === null) note.published_at = iso(now)
    note.publish_status = patch.publish_status
  }
  note.updated_at = iso(now)
  return note
}

export function removeNote(state: DbState, note: DbNote): void {
  state.notes = state.notes.filter((n) => n.id !== note.id)
}
