/**
 * Markdown 渲染：marked 解析 + DOMPurify 消毒。
 * 前端渲染不可信内容时必须先消毒（契约描述/笔记为 Markdown，来源为后台，仍按不可信处理）。
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** 渲染 Markdown → 已消毒的 HTML 字符串（经 DOMPurify 白名单过滤）。 */
export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(html, {
    // 允许基础排版；禁脚本/事件/iframe/样式注入。
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover'],
  })
}
