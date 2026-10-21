import { describe, expect, it } from 'vitest'
import { formatDate, truncate } from './text'

describe('truncate', () => {
  it('原样返回不超过最大长度的文本', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('超过最大长度时截断并追加省略号', () => {
    expect(truncate('hello world', 8)).toBe('hello w…')
  })

  it('边界：长度恰好等于最大长度时不截断', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('最大长度小于 1 时返回空串', () => {
    expect(truncate('hello', 0)).toBe('')
  })
})

describe('formatDate', () => {
  it('把 ISO 字符串格式化为 YYYY-MM-DD', () => {
    expect(formatDate('2026-10-21T10:30:00Z')).toBe('2026-10-21')
  })

  it('非法日期返回空串', () => {
    expect(formatDate('not-a-date')).toBe('')
  })
})
