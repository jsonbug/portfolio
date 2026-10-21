/**
 * 轻量、类型化的 fetch 封装，供数据获取层复用。
 *
 * mock 开关：默认在开发/测试环境走 mock（VITE_USE_MOCK 缺省且非 false 时开启），
 * 生产构建默认关闭。联调真实后端时设置 VITE_USE_MOCK=false 并配置 VITE_API_BASE_URL。
 */
import type { ApiErrorCode, ErrorDetail } from '@/types'

const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/** 是否启用 mock：生产需显式 true，其余环境默认开启（除非显式 false）。 */
const USE_MOCK = import.meta.env.PROD
  ? import.meta.env.VITE_USE_MOCK === 'true'
  : import.meta.env.VITE_USE_MOCK !== 'false'

/** 登录 token 的 localStorage 键（store 与请求层共用，避免循环依赖）。 */
export const AUTH_TOKEN_KEY = 'portfolio.admin.token'

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
  else localStorage.removeItem(AUTH_TOKEN_KEY)
}

/** 401 全局处理回调（默认清 token 后跳登录页；测试/定制可覆盖）。 */
export type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

/** 覆盖 401 全局处理（传 null 恢复默认跳转）。 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

/** 默认 401 处理：跳登录页并携带当前路径回跳。 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const url = new URL('/admin/login', window.location.origin)
  url.searchParams.set('redirect', current || '/')
  window.location.assign(url.toString())
}

export interface RequestOptions extends RequestInit {
  /** 覆盖默认 base URL，仅用于跨域调试等场景。 */
  baseUrl?: string
  /** 该请求遇 401 时不触发全局清 token + 跳登录（如登录接口本身）。 */
  skipAuthRedirect?: boolean
}

/** 带 HTTP 状态码与契约错误信息的请求错误。 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: ApiErrorCode | (string & {})
  readonly details?: ErrorDetail[]

  constructor(status: number, message: string, code?: string, details?: ErrorDetail[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await parseBody(res)
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: { code?: string; message?: string; details?: ErrorDetail[] } }).error
    return new ApiError(res.status, err.message ?? `请求失败：${res.status}`, err.code, err.details)
  }
  return new ApiError(res.status, `请求失败：${res.status} ${res.statusText}`)
}

/** 发起 JSON 请求并返回已解析的响应体；非 2xx 抛出 ApiError（含契约错误信封）。 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { baseUrl = DEFAULT_BASE_URL, skipAuthRedirect = false, ...init } = options
  const fetcher: typeof fetch = USE_MOCK ? (await import('@/mocks')).mockFetch : fetch

  // 自动附带登录 token（后台路由校验 Bearer；公开路由会忽略该头）。
  const token = getAuthToken()
  // Content-Type 仅在带 body 时设置：无 body 请求（DELETE/restore 等）带上
  // application/json 会被后端 JSON 解析器判为「空 body + json 头」而 400。
  const hasBody = init.body !== undefined && init.body !== null
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }

  const res = await fetcher(`${baseUrl}${path}`, { ...init, headers })

  if (!res.ok) {
    // 会话过期：全局清 token + 跳登录页（带回跳）。登录接口自身 401 不触发。
    if (res.status === 401 && !skipAuthRedirect) {
      setAuthToken(null)
      const handler = unauthorizedHandler ?? redirectToLogin
      handler()
    }
    throw await toApiError(res)
  }

  // 204 无内容
  if (res.status === 204) return undefined as T

  return (await parseBody(res)) as T
}
