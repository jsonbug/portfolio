/**
 * Markdown 渲染：marked 解析 + DOMPurify 消毒。
 * 前端渲染不可信内容时必须先消毒（契约描述/笔记为 Markdown，来源为后台，仍按不可信处理）。
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * 渲染结果缓存：`body_md` → HTML。
 *
 * 长篇笔记（40k 字量级）解析 + 消毒是纯 CPU 工作，切来切去不该重算；
 * 缓存以正文原文为键，因此正文不变时结果必然一致。用 Map + 上限维持 LRU 语义。
 */
const RENDER_CACHE_LIMIT = 32
const renderCache = new Map<string, string>()

/** 渲染缓存当前条目数（测试与性能对比用）。 */
export function renderCacheSize(): number {
  return renderCache.size
}

/** 清空渲染缓存（测试用）。 */
export function clearRenderCache(): void {
  renderCache.clear()
}

/** 渲染 Markdown → 已消毒的 HTML 字符串（经 DOMPurify 白名单过滤，按原文缓存）。 */
export function renderMarkdown(src: string): string {
  const hit = renderCache.get(src)
  if (hit !== undefined) {
    // 重新插入以维持最近的顺序（Map 保持插入序）。
    renderCache.delete(src)
    renderCache.set(src, hit)
    return hit
  }
  const html = marked.parse(src, { async: false }) as string
  const clean = DOMPurify.sanitize(html, {
    // 允许基础排版；禁脚本/事件/iframe/样式注入。
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover'],
  })
  renderCache.set(src, clean)
  if (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value
    if (oldest !== undefined) renderCache.delete(oldest)
  }
  return clean
}
