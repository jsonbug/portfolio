/**
 * mock 路由处理器：实现冻结契约（docs/api-contract.md）的可执行形态。
 * 通过 mockFetch 暴露（typeof fetch），在 VITE_USE_MOCK 开启时代替真实网络。
 */
import type { ErrorDetail, ErrorEnvelope, LinkCreate, LinkUpdate, NoteUpsert, ProjectCreate, ProjectUpdate } from '@/types'
import {
  addLink,
  adminListProjects,
  createDbState,
  createProject,
  deleteLink,
  deleteNote,
  getAdminProjectDetail,
  getProjectDetail,
  listTechnologies,
  publicListProjects,
  restoreProject,
  softDeleteProject,
  uid,
  updateLink,
  updateProject,
  upsertNote,
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

// ---------- 响应构造 ----------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ok(body: unknown): Response {
  return json(200, body)
}

function noContent(): Response {
  return new Response(null, { status: 204 })
}

function created(body: unknown): Response {
  return json(201, body)
}

function errorResponse(status: number, code: string, message: string, details?: ErrorDetail[]): Response {
  const envelope: ErrorEnvelope = {
    error: { code, message, ...(details ? { details } : {}), requestId: `req_${uid('req')}` },
  }
  return json(status, envelope)
}

// ---------- 校验 ----------

const HTTP_URL = /^https?:\/\/\S+$/i

function validateProjectInput(input: unknown, partial = false): ErrorDetail[] {
  const details: ErrorDetail[] = []
  const p = (input ?? {}) as Record<string, unknown>
  if (!partial && (typeof p.name !== 'string' || p.name.trim().length === 0)) {
    details.push({ field: 'name', code: 'required', message: '项目名称必填' })
  } else if (typeof p.name === 'string' && (p.name.trim().length < 1 || p.name.trim().length > 100)) {
    details.push({ field: 'name', code: 'length', message: '项目名称 1..100 字符' })
  }
  if (p.tagline != null && typeof p.tagline === 'string' && p.tagline.length > 200) {
    details.push({ field: 'tagline', code: 'length', message: '简介 ≤200 字符' })
  }
  if (p.stars != null && (!Number.isInteger(p.stars) || (p.stars as number) < 0)) {
    details.push({ field: 'stars', code: 'invalid', message: 'star 须为 ≥0 的整数' })
  }
  if (p.technologies != null) {
    if (!Array.isArray(p.technologies) || p.technologies.length > 50) {
      details.push({ field: 'technologies', code: 'invalid', message: '技术栈为数组且 ≤50 项' })
    }
  }
  if (p.status != null && !['draft', 'published', 'archived'].includes(p.status as string)) {
    details.push({ field: 'status', code: 'invalid', message: '发布状态须为 draft/published/archived' })
  }
  if (p.projectStatus != null && !['active', 'completed', 'maintained', 'paused'].includes(p.projectStatus as string)) {
    details.push({ field: 'projectStatus', code: 'invalid', message: '项目状态须为 active/completed/maintained/paused' })
  }
  if (p.coverImage != null) {
    if (typeof p.coverImage !== 'string' || p.coverImage.length > 2048 || !HTTP_URL.test(p.coverImage)) {
      details.push({ field: 'coverImage', code: 'invalid', message: '封面须为合法的 http/https 地址且 ≤2048 字符' })
    }
  }
  return details
}

function validateNoteInput(input: unknown): ErrorDetail[] {
  const details: ErrorDetail[] = []
  const n = (input ?? {}) as Record<string, unknown>
  if (typeof n.title !== 'string' || n.title.trim().length < 1 || n.title.trim().length > 200) {
    details.push({ field: 'title', code: 'required', message: '笔记标题必填（1..200）' })
  }
  if (typeof n.content !== 'string' || n.content.length < 1 || n.content.length > 100_000) {
    details.push({ field: 'content', code: 'required', message: '笔记正文必填（1..100000）' })
  }
  return details
}

function validateLinkInput(input: unknown): ErrorDetail[] {
  const details: ErrorDetail[] = []
  const l = (input ?? {}) as Record<string, unknown>
  if (typeof l.url !== 'string' || l.url.length === 0) {
    details.push({ field: 'url', code: 'required', message: '链接地址必填' })
  } else if (!HTTP_URL.test(l.url)) {
    details.push({ field: 'url', code: 'invalid', message: '链接须为合法的 http/https 地址' })
  }
  if (l.type != null && !['repo', 'website', 'demo', 'other'].includes(l.type as string)) {
    details.push({ field: 'type', code: 'invalid', message: '链接类型须为 repo/website/demo/other' })
  }
  if (l.label != null && typeof l.label === 'string' && l.label.length > 100) {
    details.push({ field: 'label', code: 'length', message: '链接名 ≤100 字符' })
  }
  if (l.sortOrder != null && (!Number.isInteger(l.sortOrder) || (l.sortOrder as number) < 0)) {
    details.push({ field: 'sortOrder', code: 'invalid', message: '排序须为 ≥0 的整数' })
  }
  return details
}

function parsePage(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

// ---------- 路由匹配 ----------

function normalizePath(pathname: string): string {
  for (const prefix of ['/api/v1', '/api']) {
    if (pathname === prefix) return '/'
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  }
  return pathname
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

interface MockRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: unknown
}

function isAuthorized(req: MockRequest): boolean {
  const auth = req.headers.authorization ?? req.headers.Authorization ?? ''
  return auth.startsWith(`Bearer ${TOKEN_PREFIX}`)
}

/** mock 处理器：根据冻结契约路由分发，返回 Response。 */
export function handleMockRequest(req: MockRequest): Response {
  const { method, path } = req

  // 公开路由
  if (method === 'GET' && path === '/health') {
    return ok({ status: 'ok', timestamp: new Date().toISOString() })
  }
  if (method === 'GET' && path === '/technologies') {
    return ok({ items: listTechnologies(state) })
  }
  if (method === 'GET' && path === '/projects') {
    const { items, ...meta } = publicListProjects(state, {
      page: parsePage(req.query.get('page'), 1, 1, Number.MAX_SAFE_INTEGER),
      pageSize: parsePage(req.query.get('pageSize'), 20, 1, 100),
      search: req.query.get('search') ?? undefined,
      technology: req.query.get('technology') ?? undefined,
    })
    return ok({ items, ...meta })
  }
  const pubDetail = matchRoute('/projects/:id', path)
  if (method === 'GET' && pubDetail) {
    const detail = getProjectDetail(state, pubDetail.id)
    if (!detail || detail.status !== 'published') {
      return errorResponse(404, 'NOT_FOUND', '项目不存在或未发布')
    }
    return ok(detail)
  }

  // 登录（契约 3.0：POST /auth/login，Bearer 守卫之外）
  if (method === 'POST' && path === '/auth/login') {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string }
    if (username === MOCK_USER && password === MOCK_PASSWORD) {
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
      return ok({ token: `${TOKEN_PREFIX}${uid('tok')}`, expiresAt })
    }
    return errorResponse(401, 'UNAUTHORIZED', '用户名或密码错误')
  }

  // 后台路由（需 Bearer）
  if (path.startsWith('/admin')) {
    if (!isAuthorized(req)) {
      return errorResponse(401, 'UNAUTHORIZED', '未登录或登录已过期')
    }

    if (method === 'GET' && path === '/admin/projects') {
      const { items, ...meta } = adminListProjects(state, {
        page: parsePage(req.query.get('page'), 1, 1, Number.MAX_SAFE_INTEGER),
        pageSize: parsePage(req.query.get('pageSize'), 20, 1, 100),
        includeDeleted: req.query.get('includeDeleted') === 'true',
        status: req.query.get('status') ?? undefined,
        search: req.query.get('search') ?? undefined,
      })
      return ok({ items, ...meta })
    }
    if (method === 'POST' && path === '/admin/projects') {
      const details = validateProjectInput(req.body)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const input = req.body as ProjectCreate
      return created(createProject(state, input))
    }

    // 项目子资源路由（先于 /admin/projects/:id 精确匹配）
    const restore = matchRoute('/admin/projects/:id/restore', path)
    if (restore && method === 'POST') {
      const restored = restoreProject(state, restore.id)
      if (!restored) return errorResponse(404, 'NOT_FOUND', '项目不存在')
      return ok(restored)
    }

    const noteOp = matchRoute('/admin/projects/:id/note', path)
    if (noteOp) {
      if (method === 'PUT') {
        const details = validateNoteInput(req.body)
        if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
        const note = upsertNote(state, noteOp.id, req.body as NoteUpsert)
        if (!note) return errorResponse(404, 'NOT_FOUND', '项目不存在')
        return ok(note)
      }
      if (method === 'DELETE') {
        if (!deleteNote(state, noteOp.id)) return errorResponse(404, 'NOT_FOUND', '项目不存在')
        return noContent()
      }
      return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
    }

    const linksOp = matchRoute('/admin/projects/:id/links', path)
    if (linksOp && method === 'POST') {
      const details = validateLinkInput(req.body)
      if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
      const link = addLink(state, linksOp.id, req.body as LinkCreate)
      if (!link) return errorResponse(404, 'NOT_FOUND', '项目不存在')
      return created(link)
    }

    const adminDetail = matchRoute('/admin/projects/:id', path)
    if (adminDetail) {
      const id = adminDetail.id
      if (method === 'GET') {
        const detail = getAdminProjectDetail(state, id)
        if (!detail) return errorResponse(404, 'NOT_FOUND', '项目不存在')
        return ok(detail)
      }
      if (method === 'PATCH') {
        const details = validateProjectInput(req.body, true)
        if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
        const result = updateProject(state, id, req.body as ProjectUpdate)
        if (!result.ok) {
          if (result.reason === 'NOT_FOUND') return errorResponse(404, 'NOT_FOUND', '项目不存在')
          return errorResponse(400, 'INVALID_STATUS_TRANSITION', '当前状态不允许此状态迁移')
        }
        return ok(result.detail)
      }
      if (method === 'DELETE') {
        if (!softDeleteProject(state, id)) return errorResponse(404, 'NOT_FOUND', '项目不存在')
        return noContent()
      }
      return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
    }

    const linkOp = matchRoute('/admin/links/:id', path)
    if (linkOp) {
      if (method === 'PATCH') {
        const details = validateLinkInput(req.body)
        if (details.length) return errorResponse(400, 'VALIDATION_ERROR', '请求参数校验失败', details)
        const link = updateLink(state, linkOp.id, req.body as LinkUpdate)
        if (!link) return errorResponse(404, 'NOT_FOUND', '链接不存在')
        return ok(link)
      }
      if (method === 'DELETE') {
        if (!deleteLink(state, linkOp.id)) return errorResponse(404, 'NOT_FOUND', '链接不存在')
        return noContent()
      }
      return errorResponse(405, 'METHOD_NOT_ALLOWED', '方法不允许')
    }

    return errorResponse(404, 'NOT_FOUND', '接口不存在')
  }

  return errorResponse(404, 'NOT_FOUND', '接口不存在')
}

/** 暴露为 fetch 形态，供 api/client.ts 在 mock 模式下使用。 */
export function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const parsed = new URL(url, 'http://localhost')
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = new Headers(init.headers)
    h.forEach((v, k) => {
      headers[k.toLowerCase()] = v
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
  return Promise.resolve(res)
}
