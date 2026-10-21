import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleMockRequest, resetMockDb } from '@/mocks/handlers'
import NotesView from './NotesView.vue'

function makeRouter(initial = '/notes') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/notes', name: 'notes', component: NotesView },
      { path: '/notes/:slug', name: 'note-detail', component: { template: '<div>detail</div>' } },
      { path: '/projects/:slug', name: 'project-detail', component: { template: '<div>project</div>' } },
    ],
  })
  void router.push(initial)
  return router
}

const admin = (method: string, path: string, body?: unknown) =>
  handleMockRequest({
    method,
    path,
    query: new URLSearchParams(),
    headers: { authorization: 'Bearer mock-token-test' },
    body,
  })

describe('NotesView', () => {
  beforeEach(() => resetMockDb())

  it('按项目分组列出公开笔记，默认选中第一篇并展示正文', async () => {
    const router = makeRouter()
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    const list = await screen.findByRole('navigation', { name: '笔记列表' })
    expect(within(list).getByRole('heading', { name: '项目展示平台' })).toBeInTheDocument()
    expect(within(list).getByRole('heading', { name: 'Chart Kit' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /为什么先做 mock-first 联调/ })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /Chart Kit 0\.9 发布说明/ })).toBeInTheDocument()
    // 归档项目下的笔记不可见；草稿也不可见
    expect(within(list).queryByText('归档项目下的笔记')).not.toBeInTheDocument()
    expect(within(list).queryByText('（草稿）下一轮想做的事')).not.toBeInTheDocument()

    // 默认选中最新一篇（published_at 倒序第一篇 = v1.2 改造笔记）
    expect(await screen.findByRole('heading', { level: 2, name: 'v1.2 改造笔记' })).toBeInTheDocument()
    expect(screen.getByText(/曝光状态与进展拆成两个字段/)).toBeInTheDocument()
  })

  it('点另一篇会把选中项写进 URL，并换成对应正文', async () => {
    const router = makeRouter()
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    const list = await screen.findByRole('navigation', { name: '笔记列表' })
    await fireEvent.click(within(list).getByRole('button', { name: /Chart Kit 0\.9 发布说明/ }))

    await waitFor(() => expect(router.currentRoute.value.query.note).toBe('chart-kit-0-9'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Chart Kit 0.9 发布说明' })).toBeInTheDocument()
  })

  it('搜索 300ms 防抖后落到 URL，并按标题/正文过滤', async () => {
    const router = makeRouter()
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    await screen.findByRole('navigation', { name: '笔记列表' })
    await fireEvent.update(screen.getByLabelText('搜索笔记'), '曝光状态')

    await waitFor(() => expect(router.currentRoute.value.query.q).toBe('曝光状态'))
    const list = screen.getByRole('navigation', { name: '笔记列表' })
    await waitFor(() => expect(within(list).getByRole('button', { name: /v1\.2 改造笔记/ })).toBeInTheDocument())
    expect(within(list).queryByRole('button', { name: /Chart Kit 0\.9 发布说明/ })).not.toBeInTheDocument()
  })

  it('URL 直接带搜索词时按该词过滤（URL 是唯一真源）', async () => {
    const router = makeRouter('/notes?q=Chart')
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    const list = await screen.findByRole('navigation', { name: '笔记列表' })
    await waitFor(() => expect(within(list).getByRole('button', { name: /Chart Kit 0\.9 发布说明/ })).toBeInTheDocument())
    expect(within(list).queryByRole('button', { name: /v1\.2 改造笔记/ })).not.toBeInTheDocument()
    expect((screen.getByLabelText('搜索笔记') as HTMLInputElement).value).toBe('Chart')
  })

  it('无结果时给出空态文案', async () => {
    const router = makeRouter('/notes?q=不存在的关键词')
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    expect(await screen.findByText('没有匹配的笔记')).toBeInTheDocument()
  })

  it('笔记总数超过 100 时提示「仅显示最近 100 篇」', async () => {
    for (let i = 0; i < 101; i += 1) {
      const res = admin('POST', '/admin/notes', {
        project_id: 'proj_portfolio',
        slug: `bulk-note-${i}`,
        title: `批量笔记 ${i}`,
        body_md: '正文',
        publish_status: 'published',
      })
      expect(res.status).toBe(201)
    }

    const router = makeRouter()
    await router.isReady()
    render(NotesView, { global: { plugins: [router] } })

    expect(await screen.findByText('仅显示最近 100 篇')).toBeInTheDocument()
  })
})
