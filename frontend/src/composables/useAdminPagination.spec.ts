import { describe, expect, it, vi } from 'vitest'
import { useAdminPagination } from './useAdminPagination'

/** 造一个按页码切片的假后端：total 条数据，每页 size 条。 */
function fakeBackend(totalItems: () => number) {
  return vi.fn(async (page: number, size: number) => {
    const total = totalItems()
    const start = (page - 1) * size
    const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => start + i)
    return { items, total }
  })
}

describe('useAdminPagination（后台项目列表与笔记列表共用）', () => {
  it('默认 20/页：21 条时第 2 页只有 1 条', async () => {
    const fetchPage = fakeBackend(() => 21)
    const pager = useAdminPagination<number>(fetchPage)

    await pager.load()
    expect(pager.items.value).toHaveLength(20)
    expect(pager.totalPages.value).toBe(2)

    pager.gotoPage(2)
    await vi.waitFor(() => expect(pager.items.value).toEqual([20]))
    expect(fetchPage).toHaveBeenLastCalledWith(2, 20)
  })

  it('末页被删空：自动回落到新的末页，而不是停在空列表', async () => {
    let total = 21
    const fetchPage = fakeBackend(() => total)
    const pager = useAdminPagination<number>(fetchPage)

    await pager.load()
    pager.gotoPage(2)
    await vi.waitFor(() => expect(pager.items.value).toEqual([20]))

    // 第 2 页那 1 条在后台被删掉，再拉一次：页码回到 1（新的末页）并有数据
    total = 20
    await pager.load()

    expect(pager.page.value).toBe(1)
    expect(pager.items.value).toHaveLength(20)
    expect(pager.totalPages.value).toBe(1)
  })

  it('回落只做一次：回落到的页仍然是空就直接给空态，不递归', async () => {
    const fetchPage = fakeBackend(() => 0)
    const pager = useAdminPagination<number>(fetchPage)

    pager.page.value = 5
    await pager.load()

    expect(pager.page.value).toBe(1)
    expect(pager.items.value).toEqual([])
    // 第 5 页 + 回落后的第 1 页 = 2 次，不会无限递归
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('gotoPage 拒绝越界与「点当前页」', async () => {
    const fetchPage = fakeBackend(() => 21)
    const pager = useAdminPagination<number>(fetchPage)
    await pager.load()
    fetchPage.mockClear()

    pager.gotoPage(1) // 已在第 1 页
    pager.gotoPage(0)
    pager.gotoPage(99)
    expect(fetchPage).not.toHaveBeenCalled()

    pager.gotoPage(2)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('取数失败落成错误文案，不动已有数据', async () => {
    const fetchPage = fakeBackend(() => 3)
    const pager = useAdminPagination<number>(fetchPage)
    await pager.load()
    expect(pager.items.value).toHaveLength(3)

    fetchPage.mockRejectedValueOnce(new Error('网络错误'))
    await pager.load()

    expect(pager.error.value).toBe('网络错误')
    expect(pager.items.value).toHaveLength(3)
    expect(pager.loading.value).toBe(false)
  })

  it('resetToFirstPage 只改页码，不自己取数', async () => {
    const fetchPage = fakeBackend(() => 21)
    const pager = useAdminPagination<number>(fetchPage)
    await pager.load()
    pager.gotoPage(2)
    await vi.waitFor(() => expect(pager.page.value).toBe(2))
    fetchPage.mockClear()

    pager.resetToFirstPage()

    expect(pager.page.value).toBe(1)
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
