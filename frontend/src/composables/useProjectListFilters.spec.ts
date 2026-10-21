import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  parseFilters,
  toQuery,
} from './useProjectListFilters'

describe('parseFilters', () => {
  it('空 query 返回默认值', () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS)
  })

  it('解析搜索词并去掉首尾空白', () => {
    expect(parseFilters({ q: '  图表  ' }).q).toBe('图表')
  })

  it('技术栈支持重复参数、逗号分隔与去重，按字典序稳定', () => {
    expect(parseFilters({ tech: ['Vue 3', 'Rust'] }).tech).toEqual(['Rust', 'Vue 3'])
    expect(parseFilters({ tech: 'Vue 3,Python' }).tech).toEqual(['Python', 'Vue 3'])
    expect(parseFilters({ tech: ['Rust', 'Rust'] }).tech).toEqual(['Rust'])
  })

  it('非法 progress / sort 静默退回默认值', () => {
    const filters = parseFilters({ progress: 'archived', sort: 'random' })
    expect(filters.progress).toBeNull()
    expect(filters.sort).toBe('recent')
  })

  it('合法 progress / sort 正常解析', () => {
    expect(parseFilters({ progress: 'launched' }).progress).toBe('launched')
    expect(parseFilters({ sort: 'stars' }).sort).toBe('stars')
  })
})

describe('toQuery', () => {
  it('默认值不写进 URL', () => {
    expect(toQuery(DEFAULT_FILTERS)).toEqual({})
  })

  it('写出非默认值', () => {
    expect(
      toQuery({ q: '图表', tech: ['Vue 3'], progress: 'ongoing', sort: 'stars' }),
    ).toEqual({ q: '图表', tech: ['Vue 3'], progress: 'ongoing', sort: 'stars' })
  })

  it('空白搜索词视为未填写', () => {
    expect(toQuery({ ...DEFAULT_FILTERS, q: '   ' })).toEqual({})
  })
})

describe('往返一致性', () => {
  it('toQuery(parseFilters(x)) 与 x 等价', () => {
    const query = { q: '图表', tech: ['Vue 3', 'Rust'], progress: 'ongoing', sort: 'stars' }
    const roundTrip = toQuery(parseFilters(query))
    expect(roundTrip).toEqual({ q: '图表', tech: ['Rust', 'Vue 3'], progress: 'ongoing', sort: 'stars' })
    expect(parseFilters(toQuery(parseFilters(query)))).toEqual(parseFilters(query))
  })
})

describe('isDefaultFilters', () => {
  it('默认状态为 true', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true)
  })

  it('任一维度变化即为 false', () => {
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, q: 'x' })).toBe(false)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, tech: ['Vue 3'] })).toBe(false)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, progress: 'launched' })).toBe(false)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, sort: 'stars' })).toBe(false)
  })
})
