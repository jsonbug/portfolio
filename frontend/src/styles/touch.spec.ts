/**
 * 触控热区契约（F7-2）。
 *
 * 背景：`pointer: coarse` 下可点面积必须 ≥44×44（`--touch-min`）。这条靠 jsdom 断言不了
 * ——jsdom 没有布局，也评估不了媒体查询；所以这里直接对**样式源码**断言：
 *   1. 令牌是 44；
 *   2. coarse 块覆盖了验收基线里那几个控件；
 *   3. coarse 块只抬可点面积，不改字号/行高（否则就是「视觉没变」的假修复）；
 *   4. 分组控件与页码只有一份定义（在 style.css），没有在页面里各写一遍。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
const css = read('src/style.css')

/** 取某个 `@media` 块的内容（按花括号配对，不靠正则偷懒）。 */
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(`@media ${query}`)
  if (start === -1) throw new Error(`缺少媒体查询 @media ${query}`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`@media ${query} 未闭合`)
}

const coarse = mediaBlock(css, '(pointer: coarse)')

describe('触控热区（pointer: coarse，F7-2）', () => {
  it('--touch-min 是 44px（WCAG 2.5.5 下限）', () => {
    expect(css).toMatch(/--touch-min:\s*44px/)
  })

  it('coarse 块覆盖验收基线里的每个控件', () => {
    // 逐项来自总验里实测偏小的那批：分段 61×32、排序 select 108×36、
    // 搜索 input、轮播箭头 30×32、面包屑 26×26、顶栏导航 39×52、页码 32×32。
    for (const selector of [
      '.segment',
      '.select',
      '.input',
      '.textarea',
      '.btn',
      '.btn-sm',
      '.btn-icon',
      '.pager-btn',
      '.shot-nav button',
      '.site-nav .nav-link',
      "nav[aria-label='面包屑'] a",
    ]) {
      expect(coarse, `${selector} 未进入 coarse 热区层`).toContain(selector)
    }
  })

  it('coarse 块只改可点面积，不改字号与行高', () => {
    expect(coarse).toContain('min-height: var(--touch-min)')
    expect(coarse).toContain('min-width: var(--touch-min)')
    // 「加 min-height 但 line-height 不变」正是评审点名的假修复：字号/行高一个都不许出现在这层
    expect(coarse).not.toMatch(/(^|[^-])(font-size|line-height)\s*:/)
  })

  it('分段与页码只有一份定义：通用层在 style.css，页面不再重复', () => {
    expect(css).toMatch(/^\.segments \{/m)
    expect(css).toMatch(/^\.segment \{/m)
    expect(css).toMatch(/^\.pager-btn \{/m)

    for (const page of [
      'src/components/ProjectFilterBar.vue',
      'src/views/admin/NoteListView.vue',
      'src/views/admin/ProjectListView.vue',
    ]) {
      const source = read(page)
      expect(source, `${page} 又写了一份 .segment/.pager-btn`).not.toMatch(/^\.(segment|segments|pager-btn)\s*\{/m)
    }
  })
})
