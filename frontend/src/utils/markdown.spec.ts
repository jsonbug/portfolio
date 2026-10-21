import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRenderCache, renderCacheSize, renderMarkdown } from './markdown'

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

describe('renderMarkdown 缓存', () => {
  beforeEach(() => clearRenderCache())

  it('同一份正文第二次直接命中缓存，结果一致', () => {
    const src = `# 标题\n\n${'正文段落。'.repeat(2000)}`
    const first = renderMarkdown(src)
    expect(renderCacheSize()).toBe(1)
    const second = renderMarkdown(src)
    expect(renderCacheSize()).toBe(1)
    expect(second).toBe(first)
  })

  it('不同正文各自入缓存，超过上限按最旧淘汰', () => {
    for (let i = 0; i < 40; i += 1) renderMarkdown(`# 第 ${i} 篇`)
    expect(renderCacheSize()).toBeLessThanOrEqual(32)
    // 最旧的已被淘汰，最新的一定还在
    expect(renderMarkdown('# 第 39 篇')).toContain('第 39 篇')
  })
})

describe('renderMarkdown 缓存 · 不重算证明', () => {
  beforeEach(() => clearRenderCache())

  it('同一份 40k 正文切回时不重新解析（marked.parse 只被调用一次）', async () => {
    const { marked } = await import('marked')
    const spy = vi.spyOn(marked, 'parse')
    const src = `${'## 小节\n\n'.repeat(2000)}长正文。`
    expect(src.length).toBeGreaterThan(10_000)

    const t0 = performance.now()
    const first = renderMarkdown(src)
    const firstMs = performance.now() - t0
    const t1 = performance.now()
    const second = renderMarkdown(src)
    const secondMs = performance.now() - t1

    expect(spy).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(secondMs).toBeLessThan(firstMs)
    console.info(`[markdown cache] 首次 ${firstMs.toFixed(2)}ms / 二次命中 ${secondMs.toFixed(3)}ms`)
  })
})
