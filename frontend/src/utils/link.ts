/**
 * 链接展示相关的纯函数。
 */

/**
 * 取出链接的可读域名（去掉协议、路径与 `www.` 前缀），用于在链接旁展示「裸域名」。
 *
 * 非法 URL 原样返回，避免渲染时抛错。
 */
export function bareDomain(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/**
 * 只放行 `http(s)` 绝对地址，其余（`javascript:`、`data:`、相对路径注入等）一律降级为 null。
 *
 * 写入侧已经在校验，但历史数据 / 迁移搬运可能绕过（见评审 P2-5），渲染侧再兜一层最便宜。
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null
}
