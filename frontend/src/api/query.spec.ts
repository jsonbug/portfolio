import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 查询串契约（docs/api-contract.md 3.1）：数组按重复参数下发、空值不下发。
 * URL 拼错不会报错，只会静默丢筛选，所以单独锁死。
 */
const urls: string[] = []

const fetchSpy = vi.fn(
  async (input: RequestInfo | URL): Promise<Response> => {
    urls.push(String(input))
    const envelope = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: { all: 0, ongoing: 0, launched: 0 },
    }
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  },
)

vi.mock('@/mocks', () => ({
  mockFetch: (input: RequestInfo | URL) => fetchSpy(input),
}))

const { listPublicProjects } = await import('./projects')
const { buildQueryString } = await import('./query')

function lastUrl(): string {
  const url = urls[urls.length - 1]
  expect(url, '未捕获到请求').toBeTruthy()
  return url
}

beforeEach(() => {
  urls.length = 0
  fetchSpy.mockClear()
})

afterEach(() => vi.clearAllMocks())

describe('buildQueryString', () => {
  it('数组展开为重复参数，且编码特殊字符', () => {
    expect(buildQueryString({ technology: ['Vue 3', 'C++'] })).toBe('?technology=Vue+3&technology=C%2B%2B')
  })

  it('undefined / null / 空串不下发，仅空白也算有效值', () => {
    expect(buildQueryString({ page: 1, search: '', progress: undefined, sort: null })).toBe('?page=1')
  })

  it('空数组不产生参数；false 与 0 保留', () => {
    expect(buildQueryString({ technology: [], includeDeleted: false, page: 0 })).toBe(
      '?includeDeleted=false&page=0',
    )
  })

  it('无有效参数时返回空串（不产生裸问号）', () => {
    expect(buildQueryString()).toBe('')
    expect(buildQueryString({ search: '' })).toBe('')
  })
})

describe('listPublicProjects', () => {
  it('多技术栈按重复参数下发', async () => {
    await listPublicProjects({ technology: ['Vue 3', 'TypeScript'], page: 1, pageSize: 12 })
    const url = new URL(lastUrl(), 'http://localhost')
    expect(url.searchParams.getAll('technology')).toEqual(['Vue 3', 'TypeScript'])
    expect(url.searchParams.get('pageSize')).toBe('12')
    expect(url.pathname).toBe('/api/v1/projects')
  })

  it('空数组不污染 URL', async () => {
    await listPublicProjects({ technology: [] })
    expect(lastUrl()).toContain('/projects')
    expect(lastUrl()).not.toContain('technology')
  })

  it('progress 与 sort 原样下发', async () => {
    await listPublicProjects({ progress: 'launched', sort: 'stars' })
    const url = new URL(lastUrl(), 'http://localhost')
    expect(url.searchParams.get('progress')).toBe('launched')
    expect(url.searchParams.get('sort')).toBe('stars')
  })
})
