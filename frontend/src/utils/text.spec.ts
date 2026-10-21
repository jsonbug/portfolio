import { describe, expect, it } from 'vitest'
import { daysAgo, formatDate, readingTimeMinutes, truncate } from './text'

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

describe('daysAgo', () => {
  const now = Date.parse('2026-10-21T12:00:00Z')

  it('按整天向下取整', () => {
    expect(daysAgo('2026-10-21T00:00:00Z', now)).toBe(0)
    expect(daysAgo('2026-10-19T13:00:00Z', now)).toBe(1)
    expect(daysAgo('2026-10-18T11:00:00Z', now)).toBe(3)
  })

  it('未来时间夹到 0', () => {
    expect(daysAgo('2026-11-01T00:00:00Z', now)).toBe(0)
  })

  it('null 与非法值返回 null', () => {
    expect(daysAgo(null, now)).toBeNull()
    expect(daysAgo('oops', now)).toBeNull()
  })
})

describe('readingTimeMinutes', () => {
  it('中文按字、英文按词，向上取整到分钟', () => {
    expect(readingTimeMinutes('')).toBe(0)
    expect(readingTimeMinutes('短文')).toBe(1)
    expect(readingTimeMinutes('字'.repeat(900))).toBe(3)
    expect(readingTimeMinutes('word '.repeat(300))).toBe(1)
  })

  it('中英混排都计入', () => {
    expect(readingTimeMinutes(`${'字'.repeat(150)} ${'word '.repeat(150)}`)).toBe(1)
  })
})
