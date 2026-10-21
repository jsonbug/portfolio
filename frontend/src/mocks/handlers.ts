/**
 * mock 路由处理器：冻结契约（docs/api-contract.md v1.2 第五/六节）的可执行形态。
 * 通过 `mockFetch` 暴露成 fetch 形态，`VITE_USE_MOCK` 开启时代替真实网络。
 *
 * 与真实后端保持一致的行为点：
 * - 前台只暴露 `published`（+ 未软删除）项目与其下已发布笔记，其余一律 404（不泄露存在性）；
 * - 旧 slug → `301 Moved Permanently` + `Location`，`mockFetch` 像浏览器一样跟随；
 * - 列表 `counts` 在 progress 过滤前统计；
 * - 曝光状态走状态机，跨级迁移 400 `INVALID_STATUS_TRANSITION`。
 */
import type {
  ErrorDetail,
  ErrorEnvelope,
  LinkCreate,
  LinkUpdate,
  NoteCreate,
  NoteUpdate,
  ProjectCreate,
  ProjectUpdate,
  PublishStatus,
} from '@/types'
import {
  addLink,
  canTransition,
  createDbState,
  createNote,
  createProject,
  findPublicNoteBySlug,
  findPublicProjectBySlug,
  isProjectVisible,
  listAdminNotes,
  listAdminProjects,
  listPublicNotes,
  listPublicProjects,
  listTechnologies,
  noteRedirectTarget,
  patchLink,
  projectRedirectTarget,
  removeLink,
  toLink,
  checkLinkNow,
  removeNote,
  replaceProjectMetadata,
  restoreProject,
  softDeleteProject,
  toAdminNoteDetail,
  toAdminProjectDetail,
  toNoteDetail,
  toProjectDetail,
  uid,
  updateNote,
  updateProject,
  type DbState,
} from './db'

let state: DbState = createDbState()

/** 重置 mock 状态（测试隔离用）。 */
export function resetMockDb(): void {
  state = createDbState()
}

export function getMockDb(): DbState {
  return state
}

const TOKEN_PREFIX = 'mock-token-'
const MOCK_USER = import.meta.env.VITE_MOCK_ADMIN_USER || 'admin'
const MOCK_PASSWORD = import.meta.env.VITE_MOCK_ADMIN_PASSWORD || 'admin123'

const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/
const HTTP_URL = /^https?:\/\/\S+$/i

const PUBLISH_STATUSES: PublishStatus[] = ['draft', 'published', 'archived']
const PROGRESSES = ['ongoing', 'launched'] as const
const LINK_TYPES = ['repo', 'site', 'docs', 'demo', 'other'] as const
const NOTE_STATUSES = ['draft', 'published'] as const

// ---------- 响应构造 ----------

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const ok = (body: unknown): Response => json(200, body)
const created = (body: unknown): Response => json(201, body)
const noContent = (): Response => new Response(null, { status: 204 })

function errorResponse(status: number, code: string, message: string, details?: ErrorDetail[]): Response {
  const envelope: ErrorEnvelope = {
    error: { code, message, ...(details ? { details } : {}), requestId: `req_${uid('req')}` },
  }
  return json(status, envelope)
}

/** 旧 slug 301：Location 指向契约内的绝对 API 路径。 */
function movedPermanently(location: string): Response {
  return new Response(null, { status: 301, headers: { Location: location } })
}

// ---------- 校验 ----------

function validateSlug(value: unknown, field: string, required: boolean): ErrorDetail[] {
  if (value === undefined || value === null) {
    return required ? [{ field, code: 'required', message: `${field} 必填` }] : []
  }
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    return [
      {
        field,
        code: 'invalid_string',
        message: 'slug 只能包含小写字母、数字与连字符，长度 2–64',
      },
    ]
  }
  return []
}

function lengthDetail(field: string, max: number): ErrorDetail {
  return { field, code: 'length', message: `${field} 最长 ${max} 字符` }
}

function validateUrl(value: unknown, field: string): ErrorDetail[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'string' || value.length > 2048 || !HTTP_URL.test(value)) {
    return [{ field, code: 'invalid', message: `${field} 须为合法的 http/https 地址且 ≤2048 字符` }]
  }
  return []
}

function validateNullableString(
  value: unknown,
  field: string,
  max: number,
): ErrorDetail[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'string') return [{ field, code: 'invalid_type', message: `${field} 须为字符串` }]
  return value.length > max ? [lengthDetail(field, max)] : []
}

function validateNullableInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
): ErrorDetail[] {
  if (value === undefined || value === null) return []
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return [{ field, code: 'invalid', message: `${field} 须为 ${min}..${max} 的整数` }]
  }
  return []
}

/** `ProjectUpsert` 校验（PATCH 时 slug 非必填且不参与重名校验）。 */
function validateProjectInput(input: unknown, partial = false): ErrorDetail[] {
  const body = (input ?? {}) as Record<string, unknown>
  const details: ErrorDetail[] = [
    ...validateSlug(body.slug, 'slug', !partial),
    ...validateNullableString(body.name, 'name', 100),
    ...validateNullableString(body.summary, 'summary', 60),
    ...validateNullableString(body.description_md, 'description_md', 100_000),
    ...validateNullableString(body.version, 'version', 50),
    ...validateNullableString(body.role, 'role', 100),
    ...validateNullableString(body.license, 'license', 100),
    ...validateUrl(body.cover_image_url, 'cover_image_url'),
    ...validateUrl(body.cover_source_url, 'cover_source_url'),
    ...validateNullableInt(body.stars, 'stars', 0, Number.MAX_SAFE_INTEGER),
    ...validateNullableInt(body.start_year, 'start_year', 1000, 9999),
    ...validateNullableInt(body.team_size, 'team_size', 1, 100_000),
  ]

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      details.push({ field: 'name', code: 'required', message: '项目名称必填' })
    }
  }
  if (body.publish_status !== undefined && !PUBLISH_STATUSES.includes(body.publish_status as PublishStatus)) {
    details.push({ field: 'publish_status', code: 'invalid', message: 'publish_status 须为 draft/published/archived' })
  }
  if (body.progress !== undefined && !PROGRESSES.includes(body.progress as (typeof PROGRESSES)[number])) {
    details.push({ field: 'progress', code: 'invalid', message: 'progress 须为 ongoing/launched' })
  }
  if (body.tech_stack !== undefined) {
    const stack = body.tech_stack
    if (!Array.isArray(stack) || stack.some((t) => typeof t !== 'string' || t.length > 50)) {
      details.push({ field: 'tech_stack', code: 'invalid', message: 'tech_stack 为字符串数组，每项 ≤50 字符' })
    }
  }
  return details
}

function validateNoteInput(input: unknown, partial = false): ErrorDetail[] {
  const body = (input ?? {}) as Record<string, unknown>
  const details: ErrorDetail[] = [...validateSlug(body.slug, 'slug', !partial)]

  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 200) {
      details.push({ field: 'title', code: 'required', message: '笔记标题必填（1..200）' })
    }
  }
  if (!partial || body.body_md !== undefined) {
    if (typeof body.body_md !== 'string' || body.body_md.length < 1 || body.body_md.length > 100_000) {
      details.push({ field: 'body_md', code: 'required', message: '笔记正文必填（1..100000）' })
    }
  }
  if (!partial) {
    if (typeof body.project_id !== 'string' || body.project_id.length === 0) {
      details.push({ field: 'project_id', code: 'required', message: '所属项目必填' })
    }
  }
  if (body.publish_status !== undefined && !(NOTE_STATUSES as readonly string[]).includes(body.publish_status as string)) {
    details.push({ field: 'publish_status', code: 'invalid', message: '笔记状态须为 draft/published' })
  }
  if (body.tags !== undefined) {
    const tags = body.tags
    if (!Array.isArray(tags) || tags.length > 20 || tags.some((t) => typeof t !== 'string' || t.length > 50)) {
      details.push({ field: 'tags', code: 'invalid', message: 'tags 最多 20 个，每个 ≤50 字符' })
    }
  }
  return details
}

function validateLinkInput(input: unknown, partial = false): ErrorDetail[] {
  const body = (input ?? {}) as Record<string, unknown>
  const details: ErrorDetail[] = [...validateUrl(body.url, 'url')]
  // PATCH 允许只改标签/排序，url 仅在缺省于 POST 时必填。
  if (!partial && (typeof body.url !== 'string' || body.url.length === 0)) {
    details.push({ field: 'url', code: 'required', message: '链接地址必填' })
  }
  if (body.type !== undefined && !LINK_TYPES.includes(body.type as (typeof LINK_TYPES)[number])) {
    details.push({ field: 'type', code: 'invalid', message: '链接类型须为 repo/site/docs/demo/other' })
  }
  details.push(...validateNullableString(body.label, 'label', 100))
  details.push(...validateNullableInt(body.sort, 'sort', 0, Number.MAX_SAFE_INTEGER))
  return details
}

function validateMetadataInput(input: unknown): ErrorDetail[] {
  const body = (input ?? {}) as Record<string, unknown>
  const items = body.items
  if (!Array.isArray(items)) {
    return [{ field: 'items', code: 'required', message: 'items 必须为数组' }]
  }
  if (items.length > 50) {
    return [{ field: 'items', code: 'max_items', message: '自定义元数据最多 50 条' }]
  }
  const details: ErrorDetail[] = []
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>
    const key = typeof row.key_label === 'string' ? row.key_label.trim() : ''
    if (!key || key.length > 50) {
      details.push({ field: `items[${index}].key_label`, code: 'length', message: '键名必填且 ≤50 字符' })
    } else if (seen.has(key)) {
      details.push({ field: `items[${index}].key_label`, code: 'duplicate', message: `键名重复：${key}` })
    }
    seen.add(key)
    if (typeof row.value !== 'string' || row.value.length > 500) {
      details.push({ field: `items[${index}].value`, code: 'length', message: '值必填且 ≤500 字符' })
    }
  })
  return details
}

// ---------- 查询参数 ----------

/**
 * 解析分页参数：**不夹取**（契约 1：越界一律 400）。
 *
 * 与真实后端一致：`page < 1`、`pageSize` 不在 1..100、非整数都算参数错误。
 */
function parsePage(
  query: URLSearchParams,
): { page: number; pageSize: number } | Response {
  const details: ErrorDetail[] = []
  const page = Number(query.get('page') ?? 1)
  const pageSize = Number(query.get('pageSize') ?? 20)
  if (!Number.isInteger(page) || page < 1) {
    details.push({ field: 'page', code: 'RANGE', message: '必须是 ≥ 1 的整数' })
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    details.push({ field: 'pageSize', code: 'RANGE', message: '必须是 1..100 的整数' })
  }
  if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
  return { page, pageSize }
}

/** 页码超出最后一页 → 400（契约 1：越界不夹取、不返回空页）。 */
function beyondLastPage(page: number, totalPages: number): boolean {
  return page > Math.max(1, totalPages)
}

function pageOutOfRange(totalPages: number): Response {
  return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', [
    { field: 'page', code: 'RANGE', message: `超出总页数（${totalPages}）` },
  ])
}

/** 支持 `?technology=A&technology=B` 与 `?technology=A,B` 两种写法（契约 3.1）。 */
function queryList(query: URLSearchParams, key: string): string[] {
  return query
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

function queryBool(query: URLSearchParams, key: string): boolean {
  const raw = query.get(key)
  return raw === 'true' || raw === '1'
}

function queryEnum<T extends string>(query: URLSearchParams, key: string, values: readonly T[]): T | undefined {
  const raw = query.get(key)
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined
}

// ---------- 路由 ----------

function normalizePath(pathname: string): string {
  for (const prefix of ['/api/v1', '/api']) {
    if (pathname === prefix) return '/'
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  }
  return pathname
}

export interface MockRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: unknown
}

function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i += 1) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i])
    else if (pp[i] !== sp[i]) return null
  }
  return params
}

function isAuthorized(req: MockRequest): boolean {
  const auth = req.headers.authorization ?? ''
  return auth.startsWith(`Bearer ${TOKEN_PREFIX}`)
}

function notFound(what = '资源'): Response {
  // 前台对草稿/归档/软删除一律 404，不泄露存在性（契约 1.3）。
  return errorResponse(404, 'NOT_FOUND', `${what}不存在`)
}

/** 契约 3.1：前台项目列表 + 分段计数。 */
function handlePublicProjectList(query: URLSearchParams): Response {
  const paging = parsePage(query)
  if (paging instanceof Response) return paging
  const envelope = listPublicProjects(state, {
    page: paging.page,
    pageSize: paging.pageSize,
    search: query.get('search') ?? undefined,
    technology: queryList(query, 'technology'),
    progress: queryEnum(query, 'progress', PROGRESSES),
    sort: queryEnum(query, 'sort', ['recent', 'stars'] as const),
  })
  if (beyondLastPage(paging.page, envelope.totalPages)) {
    return pageOutOfRange(envelope.totalPages)
  }
  return ok(envelope)
}

function handlePublicProjectDetail(resource: string): Response {
  const redirect = projectRedirectTarget(state, resource)
  if (redirect) return movedPermanently(`/api/v1/projects/${encodeURIComponent(redirect)}`)

  const project = findPublicProjectBySlug(state, resource)
  if (!project || !isProjectVisible(project)) return notFound('项目')
  return ok(toProjectDetail(state, project))
}

function handlePublicNoteDetail(resource: string): Response {
  const redirect = noteRedirectTarget(state, resource)
  if (redirect) return movedPermanently(`/api/v1/notes/${encodeURIComponent(redirect)}`)

  const note = findPublicNoteBySlug(state, resource)
  if (!note) return notFound('笔记')
  return ok(toNoteDetail(state, note))
}

/** 后台路由（已通过 Bearer 校验）。 */
function handleAdmin(req: MockRequest): Response {
  const { method, path, query, body } = req

  // ---- 项目 ----
  if (path === '/admin/projects') {
    if (method === 'GET') {
      const paging = parsePage(query)
      if (paging instanceof Response) return paging
      const envelope = listAdminProjects(state, {
        page: paging.page,
        pageSize: paging.pageSize,
        publish_status: queryEnum(query, 'publish_status', PUBLISH_STATUSES),
        progress: queryEnum(query, 'progress', PROGRESSES),
        search: query.get('search') ?? undefined,
        includeDeleted: queryBool(query, 'includeDeleted'),
      })
      if (beyondLastPage(paging.page, envelope.totalPages)) {
        return pageOutOfRange(envelope.totalPages)
      }
      return ok(envelope)
    }
    if (method === 'POST') {
      const details = validateProjectInput(body)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const input = body as ProjectCreate
      const conflict = state.projects.some((p) => p.slug === input.slug)
      if (conflict) return errorResponse(409, 'CONFLICT', `slug 已被占用：${input.slug}`)
      return created(toAdminProjectDetail(state, createProject(state, input)))
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
  }

  const restore = matchRoute('/admin/projects/:id/restore', path)
  if (restore && method === 'POST') {
    const project = state.projects.find((p) => p.id === restore.id)
    if (!project) return notFound('项目')
    return ok(toAdminProjectDetail(state, restoreProject(project)))
  }

  const metadataOp = matchRoute('/admin/projects/:id/metadata', path)
  if (metadataOp && method === 'PUT') {
    const project = state.projects.find((p) => p.id === metadataOp.id)
    if (!project) return notFound('项目')
    const details = validateMetadataInput(body)
    if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
    replaceProjectMetadata(
      state,
      project.id,
      (body as { items: Array<{ key_label: string; value: string }> }).items,
    )
    return ok(toAdminProjectDetail(state, project))
  }

  const linksOp = matchRoute('/admin/projects/:id/links', path)
  if (linksOp && method === 'POST') {
    const project = state.projects.find((p) => p.id === linksOp.id)
    if (!project) return notFound('项目')
    const details = validateLinkInput(body)
    if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
    return created(toLink(addLink(state, project.id, body as LinkCreate)))
  }

  const adminProject = matchRoute('/admin/projects/:id', path)
  if (adminProject) {
    const project = state.projects.find((p) => p.id === adminProject.id)
    if (!project) return notFound('项目')

    if (method === 'GET') return ok(toAdminProjectDetail(state, project))

    if (method === 'PATCH') {
      const details = validateProjectInput(body, true)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const patch = (body ?? {}) as ProjectUpdate
      if (patch.slug !== undefined && patch.slug !== project.slug) {
        if (state.projects.some((p) => p.slug === patch.slug && p.id !== project.id)) {
          return errorResponse(409, 'CONFLICT', `slug 已被占用：${patch.slug}`)
        }
      }
      if (patch.publish_status && !canTransition(project.publish_status, patch.publish_status)) {
        return errorResponse(
          400,
          'INVALID_STATUS_TRANSITION',
          `不允许从 ${project.publish_status} 迁移到 ${patch.publish_status}`,
        )
      }
      return ok(toAdminProjectDetail(state, updateProject(state, project, patch)))
    }

    if (method === 'DELETE') {
      // 软删除：幂等，返回详情（契约 4.1）。
      return ok(toAdminProjectDetail(state, softDeleteProject(state, project)))
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
  }

  const linkOp = matchRoute('/admin/links/:id', path)
  if (linkOp) {
    const link = state.links.find((l) => l.id === linkOp.id)
    if (!link) return notFound('链接')
    if (method === 'PATCH') {
      const details = validateLinkInput(body, true)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      return ok(toLink(patchLink(state, link, body as LinkUpdate)))
    }
    if (method === 'DELETE') {
      removeLink(state, link)
      return noContent()
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
  }

  const linkCheck = matchRoute('/admin/links/:id/check', path)
  if (linkCheck) {
    if (method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
    const link = state.links.find((l) => l.id === linkCheck.id)
    if (!link) return notFound('链接')
    return ok(toLink(checkLinkNow(state, link)))
  }

  // ---- 笔记（N:1） ----
  if (path === '/admin/notes') {
    if (method === 'GET') {
      const paging = parsePage(query)
      if (paging instanceof Response) return paging
      const envelope = listAdminNotes(state, {
        page: paging.page,
        pageSize: paging.pageSize,
        project_id: query.get('project_id') ?? undefined,
        publish_status: queryEnum(query, 'publish_status', NOTE_STATUSES),
        search: query.get('search') ?? undefined,
      })
      if (beyondLastPage(paging.page, envelope.totalPages)) {
        return pageOutOfRange(envelope.totalPages)
      }
      return ok(envelope)
    }
    if (method === 'POST') {
      const details = validateNoteInput(body)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const input = body as NoteCreate
      // 项目不存在 → 404（含软删除项目）；笔记 slug 在 note 命名空间内唯一。
      const project = state.projects.find((p) => p.id === input.project_id)
      if (!project) return notFound('项目')
      if (state.notes.some((n) => n.slug === input.slug)) {
        return errorResponse(409, 'CONFLICT', `slug 已被占用：${input.slug}`)
      }
      return created(toAdminNoteDetail(state, createNote(state, input)))
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
  }

  const adminNote = matchRoute('/admin/notes/:id', path)
  if (adminNote) {
    const note = state.notes.find((n) => n.id === adminNote.id)
    if (!note) return notFound('笔记')

    if (method === 'GET') return ok(toAdminNoteDetail(state, note))

    if (method === 'PATCH') {
      const details = validateNoteInput(body, true)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const patch = (body ?? {}) as NoteUpdate
      if (patch.slug !== undefined && patch.slug !== note.slug) {
        if (state.notes.some((n) => n.slug === patch.slug && n.id !== note.id)) {
          return errorResponse(409, 'CONFLICT', `slug 已被占用：${patch.slug}`)
        }
      }
      return ok(toAdminNoteDetail(state, updateNote(state, note, patch)))
    }

    if (method === 'DELETE') {
      removeNote(state, note)
      return noContent()
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
  }

  return notFound('接口')
}

/** mock 处理器：按冻结契约分发，返回 Response。 */
export function handleMockRequest(req: MockRequest): Response {
  const { method, path } = req

  // ---- 公开路由 ----
  if (method === 'GET' && path === '/health') {
    return ok({ status: 'ok', uptime: (Date.now() - state.now) / 1000 })
  }
  if (method === 'GET' && path === '/technologies') {
    return ok({ items: listTechnologies(state) })
  }
  if (method === 'GET' && path === '/projects') {
    return handlePublicProjectList(req.query)
  }
  const publicProject = matchRoute('/projects/:slug', path)
  if (method === 'GET' && publicProject) {
    return handlePublicProjectDetail(publicProject.slug)
  }
  if (method === 'GET' && path === '/notes') {
    const paging = parsePage(req.query)
    if (paging instanceof Response) return paging
    const envelope = listPublicNotes(state, {
      page: paging.page,
      pageSize: paging.pageSize,
      search: req.query.get('search') ?? undefined,
      tag: req.query.get('tag') ?? undefined,
    })
    if (beyondLastPage(paging.page, envelope.totalPages)) {
      return pageOutOfRange(envelope.totalPages)
    }
    return ok(envelope)
  }
  const publicNote = matchRoute('/notes/:slug', path)
  if (method === 'GET' && publicNote) {
    return handlePublicNoteDetail(publicNote.slug)
  }

  // ---- 登录（在 Bearer 守卫之外） ----
  if (method === 'POST' && path === '/auth/login') {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string }
    if (username === MOCK_USER && password === MOCK_PASSWORD) {
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
      return ok({ token: `${TOKEN_PREFIX}${uid('tok')}`, expiresAt })
    }
    return errorResponse(401, 'UNAUTHORIZED', '用户名或密码错误')
  }

  // ---- 后台路由 ----
  if (path.startsWith('/admin')) {
    if (!isAuthorized(req)) return errorResponse(401, 'UNAUTHORIZED', '未登录或登录已过期')
    return handleAdmin(req)
  }

  return notFound('接口')
}

/** 暴露为 fetch 形态；301 像浏览器一样跟随（最多 3 跳）。 */
export async function mockFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  _depth = 0,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const parsed = new URL(url, 'http://localhost')
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
  }
  let body: unknown
  if (init?.body) {
    try {
      body = JSON.parse(init.body as string)
    } catch {
      body = init.body
    }
  }

  const res = handleMockRequest({
    method,
    path: normalizePath(parsed.pathname),
    query: parsed.searchParams,
    headers,
    body,
  })

  const location = res.headers.get('Location')
  if (res.status === 301 && location && _depth < 3) {
    return mockFetch(location, init, _depth + 1)
  }
  return res
}
