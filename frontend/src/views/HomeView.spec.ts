import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import HomeView from './HomeView.vue'

const CARD_NAMES = ['项目展示平台', 'Chart Kit', '抓取工具箱']

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/projects/:slug', name: 'project-detail', component: { template: '<div>detail</div>' } },
    ],
  })
}

async function renderHome(initial = '/') {
  const router = makeRouter()
  await router.push(initial)
  await router.isReady()
  const utils = render(HomeView, { global: { plugins: [router] } })
  return { router, ...utils }
}

/** 卡片标题顺序（页面 h1 是 Display 标题，卡片是 h2）。 */
function cardNames(): string[] {
  return screen.queryAllByRole('heading', { level: 2 }).map((el) => el.textContent?.trim() ?? '')
}

function searchInput(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: '搜索项目' }) as HTMLInputElement
}

/** 等到列表渲染完成（骨架消失、出现指定卡片）。 */
async function waitForList(name = CARD_NAMES[0]): Promise<void> {
  await screen.findByRole('heading', { level: 2, name })
}

describe('HomeView 列表', () => {
  beforeEach(() => resetMockDb())

  it('只展示 published 且未软删除的项目', async () => {
    await renderHome()
    await waitForList()
    expect(cardNames().sort()).toEqual([...CARD_NAMES].sort())
    expect(screen.queryByText('还没想好的东西')).not.toBeInTheDocument()
    expect(screen.queryByText('旧博客')).not.toBeInTheDocument()
    expect(screen.queryByText('被软删的工具')).not.toBeInTheDocument()
  })

  it('页头给出项目总数与最近更新时间', async () => {
    await renderHome()
    await waitForList()
    expect(screen.getByRole('heading', { level: 1, name: '项目' })).toBeInTheDocument()
    expect(screen.getByText('3 个项目')).toBeInTheDocument()
    expect(screen.getByText(/最近更新 \d+ 天前|今天更新/)).toBeInTheDocument()
  })

  it('首屏先渲染骨架，加载完成后换成卡片', async () => {
    await renderHome()
    expect(document.querySelectorAll('.skeleton-card').length).toBeGreaterThan(0)
    await waitForList()
    expect(document.querySelectorAll('.skeleton-card')).toHaveLength(0)
  })

  it('卡片包含 star、更新时间、进展徽标与仓库/官网双入口', async () => {
    await renderHome()
    await waitForList()
    const card = screen.getByRole('link', { name: '查看项目：项目展示平台' }).closest('article')
    expect(card).not.toBeNull()
    const scope = within(card as HTMLElement)
    expect(scope.getByText('★ 128')).toBeInTheDocument()
    expect(scope.getByText(/更新$/)).toBeInTheDocument()
    expect(scope.getByText('进行中')).toBeInTheDocument()
    expect(scope.getByText('把散落在收藏夹里的项目收进一个可检索、可记笔记的展示站。')).toBeInTheDocument()
    expect(scope.getByRole('link', { name: /仓库/ })).toHaveAttribute(
      'href',
      'https://github.com/jsonbug/portfolio',
    )
    expect(scope.getByRole('link', { name: /官网/ })).toHaveAttribute(
      'href',
      'https://portfolio.example.com',
    )
    expect(scope.getByRole('link', { name: /仓库/ })).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('HomeView 分段', () => {
  beforeEach(() => resetMockDb())

  it('三个分段带计数，且没有「已归档」分段', async () => {
    await renderHome()
    await waitForList()
    expect(screen.getByRole('button', { name: '全部 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '进行中 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已上线 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /归档/ })).not.toBeInTheDocument()
  })

  it('切到「进行中」只留进行中的项目，并同步 URL', async () => {
    const { router } = await renderHome()
    await waitForList()
    await fireEvent.click(screen.getByRole('button', { name: '进行中 2' }))

    await waitFor(() => expect(cardNames().sort()).toEqual(['抓取工具箱', '项目展示平台'].sort()))
    expect(router.currentRoute.value.query.progress).toBe('ongoing')
  })

  it('切到「已上线」只留已上线项目', async () => {
    const { router } = await renderHome()
    await waitForList()
    await fireEvent.click(screen.getByRole('button', { name: '已上线 1' }))

    await waitFor(() => expect(cardNames()).toEqual(['Chart Kit']))
    expect(router.currentRoute.value.query.progress).toBe('launched')
  })

  it('URL 里带着分段时首屏直接按该分段渲染', async () => {
    await renderHome('/?progress=launched')
    await waitForList('Chart Kit')
    expect(cardNames()).toEqual(['Chart Kit'])
    expect(screen.getByRole('button', { name: '已上线 1' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('HomeView 搜索', () => {
  beforeEach(() => resetMockDb())

  it('输入 300ms 后才搜索（名称或摘要命中），并写入 URL', async () => {
    const { router } = await renderHome()
    await waitForList()

    await fireEvent.update(searchInput(), '图表')
    expect(router.currentRoute.value.query.q).toBeUndefined()

    await waitFor(
      () => {
        expect(cardNames()).toEqual(['Chart Kit'])
      },
      { timeout: 2000 },
    )
    expect(router.currentRoute.value.query.q).toBe('图表')
  })

  it('URL 里的搜索词回填到输入框', async () => {
    await renderHome('/?q=抓取')
    await waitForList('抓取工具箱')
    expect(searchInput().value).toBe('抓取')
    expect(cardNames()).toEqual(['抓取工具箱'])
  })

  it('无结果时展示空态并可一键清除筛选', async () => {
    const { router } = await renderHome('/?q=不存在的项目')
    const empty = (await screen.findByText('没有符合条件的项目')).closest('.empty') as HTMLElement
    expect(empty).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()

    await fireEvent.click(within(empty).getByRole('button', { name: '清除筛选' }))

    await waitFor(() => expect(cardNames().sort()).toEqual([...CARD_NAMES].sort()))
    expect(router.currentRoute.value.query).toEqual({})
  })
})

describe('HomeView 技术栈与排序', () => {
  beforeEach(() => resetMockDb())

  it('技术栈多选：点选后按技术栈过滤，再点一次取消', async () => {
    const { router } = await renderHome()
    await waitForList()

    await fireEvent.click(screen.getByRole('button', { name: 'Python' }))
    await waitFor(() => expect(cardNames()).toEqual(['抓取工具箱']))
    expect(router.currentRoute.value.query.tech).toEqual(['Python'])

    await fireEvent.click(screen.getByRole('button', { name: 'Python' }))
    await waitFor(() => expect(cardNames().sort()).toEqual([...CARD_NAMES].sort()))
    expect(router.currentRoute.value.query.tech).toBeUndefined()
  })

  it('排序可切到 star 降序，并同步 URL', async () => {
    const { router } = await renderHome()
    await waitForList()
    // 默认按最近更新倒序：2 天前 → 7 天前 → 40 天前
    expect(cardNames()).toEqual(['项目展示平台', '抓取工具箱', 'Chart Kit'])

    await fireEvent.update(screen.getByRole('combobox', { name: '排序' }), 'stars')

    await waitFor(() => expect(cardNames()).toEqual(['Chart Kit', '项目展示平台', '抓取工具箱']))
    expect(router.currentRoute.value.query.sort).toBe('stars')
  })
})

describe('HomeView 筛选状态', () => {
  beforeEach(() => resetMockDb())

  it('默认不显示「清除筛选」，有筛选时显示', async () => {
    await renderHome()
    await waitForList()
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: '进行中 2' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument(),
    )
  })
})
