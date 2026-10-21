import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('渲染基础 Markdown（标题/列表/链接）', () => {
    const html = renderMarkdown('# 标题\n\n- 甲\n- 乙\n\n[链接](https://example.com)')
    expect(html).toContain('<h1')
    expect(html).toContain('<li>')
    expect(html).toContain('href="https://example.com"')
  })

  it('消毒脚本与事件属性（防 XSS）', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('空串返回空', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
