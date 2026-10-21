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
