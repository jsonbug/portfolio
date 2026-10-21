/**
 * 登录页的纯逻辑（无 Vue 依赖，便于单测）。
 *
 * 两条规矩写在契约里，这里只是落地：
 * - 契约 §1.3：`POST /auth/login` 失败恒为 401 `UNAUTHORIZED`，**不区分账号不存在与口令错误**。
 *   所以界面上不允许出现「该账号不存在」这类文案，也不把后端 message 原样贴出来
 *   （生产 message 已不带配置细节，但它是后端内部措辞，不是给用户看的）。
 * - 回跳地址只接受站内绝对路径，挡掉 `//evil.com`、`https://evil.com`、`javascript:` 这类外跳。
 */

/** 登录成功后回落的默认页。 */
export const DEFAULT_ADMIN_PATH = '/admin/projects'

/** 失败文案：全部由前端固定，后端 message 一律不透传。 */
export const LOGIN_ERROR_COPY = {
  credentials: '账号或密码不正确',
  rateLimited: '尝试次数过多，请稍后再试',
  network: '登录失败，请检查网络后重试',
  unknown: '登录失败，请稍后重试',
} as const

/**
 * 校验回跳地址：必须是站内绝对路径。
 *
 * 拒绝 `//host`（协议相对）、含协议的绝对 URL、以及任何不以 `/` 开头的值。
 * 也拒绝回跳回登录页自身（否则登录成功又弹回登录页）。
 */
export function safeRedirect(raw: unknown, fallback: string = DEFAULT_ADMIN_PATH): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.startsWith('/admin/login')) return fallback
  // 反斜杠在部分浏览器里等价于 `/`（`/\evil.com`），一并挡掉
  if (value.includes('\\')) return fallback
  return value
}

/** 登录失败的用户可见文案：按状态码分流，正文恒定，不泄账号是否存在。 */
export function loginErrorMessage(status: number | null): string {
  if (status === 401) return LOGIN_ERROR_COPY.credentials
  if (status === 429) return LOGIN_ERROR_COPY.rateLimited
  if (status === null) return LOGIN_ERROR_COPY.network
  return LOGIN_ERROR_COPY.unknown
}
