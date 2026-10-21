import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { listPublicNotes } from '@/api/notes'
import { handleMockRequest, resetMockDb } from '@/mocks/handlers'
import NoteDetailView from './NoteDetailView.vue'

function makeRouter(initial: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/notes', name: 'notes', component: { template: '<div>notes</div>' } },
      { path: '/notes/:slug', name: 'note-detail', component: NoteDetailView, props: true },
      { path: '/projects/:slug', name: 'project-detail', component: { template: '<div>project</div>' } },
    ],
  })
  void router.push(initial)
  return router
}

async function renderNote(slug: string) {
  const router = makeRouter(`/notes/${slug}`)
  await router.isReady()
  render(NoteDetailView, { props: { slug }, global: { plugins: [router] } })
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

describe('NoteDetailView 三栏（09/10 稿）', () => {
  beforeEach(() => resetMockDb())

  it('左栏是笔记树：搜索框 + 按项目分组 + 当前篇白卡', async () => {
    await renderNote('why-mock-first')

    const tree = await screen.findByRole('complementary', { name: '笔记树' })
    expect(within(tree).getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument()
    const list = within(tree).getByRole('navigation', { name: '笔记列表' })
    // 按项目分组：分组标题是项目名
    expect(await within(list).findByRole('heading', { name: '项目展示平台' })).toBeInTheDocument()
    const current = await within(list).findByRole('button', { name: /为什么先做 mock-first 联调/ })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(current).toHaveClass('note-link--active')
  })

  it('右栏同时放「本页目录」与「所属项目」（目录不再在左栏）', async () => {
    await renderNote('v1-2-notes')

    const right = await screen.findByRole('complementary', { name: '', hidden: false }).catch(() => null)
    void right
    const toc = await screen.findByRole('region', { name: '本页目录' })
    const project = await screen.findByRole('region', { name: '所属项目' })
    // 同一列（祖先 aside 相同），且不在「笔记树」里
    expect(toc.closest('aside')).toBe(project.closest('aside'))
    expect(toc.closest('aside')?.getAttribute('aria-label')).not.toBe('笔记树')
  })

  it('点树里的另一篇会切到对应路由', async () => {
    const router = await renderNote('why-mock-first')
    const tree = await screen.findByRole('complementary', { name: '笔记树' })
    const other = await within(tree).findByRole('button', { name: /v1.2 改造笔记/ })

    await fireEvent.click(other)

    await waitFor(() => expect(router.currentRoute.value.params.slug).toBe('v1-2-notes'))
    expect(router.currentRoute.value.name).toBe('note-detail')
  })
})

describe('NoteDetailView', () => {
  beforeEach(() => resetMockDb())

  it('渲染标题、所属项目、日期、阅读时长与标签', async () => {
    await renderNote('v1-2-notes')

    expect(await screen.findByRole('heading', { level: 1, name: 'v1.2 改造笔记' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '项目展示平台' })).toBeInTheDocument()
    expect(screen.getByText('约 1 分钟')).toBeInTheDocument()
    const tags = screen.getByRole('list', { name: '标签' })
    expect(within(tags).getByText('决策')).toBeInTheDocument()
  })

  it('正文 h2/h3 生成目录锚点，并与正文标题一一对应', async () => {
    const created = admin('POST', '/admin/notes', {
      project_id: 'proj_portfolio',
      slug: 'toc-demo',
      title: '带目录的笔记',
      body_md: '# 不该进目录的一级标题\n\n## 背景\n\n内容。\n\n### 细节\n\n更多内容。\n',
      publish_status: 'published',
    })
    expect(created.status).toBe(201)

    await renderNote('toc-demo')

    const toc = await screen.findByRole('region', { name: '本页目录' })
    const links = within(toc).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['背景', '细节'])
    // 锚点指向正文里真实存在的标题
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? ''
      expect(document.getElementById(id)).not.toBeNull()
    }
  })

  it('给出上下篇导航与「全部笔记」返回入口', async () => {
    await renderNote('v1-2-notes')

    // 按 published_at 倒序：v1-2-notes → why-mock-first → chart-kit-0-9
    const siblings = await screen.findByRole('navigation', { name: '上下篇' })
    expect(within(siblings).queryByRole('link', { name: /上一篇/ })).not.toBeInTheDocument()
    expect(within(siblings).getByRole('link', { name: /下一篇/ })).toHaveTextContent('为什么先做 mock-first 联调')
    expect(screen.getByRole('link', { name: '← 全部笔记' })).toBeInTheDocument()
  })

  it('旧 slug 301 后仍能渲染', async () => {
    await renderNote('v1-2-notes-old')
    expect(await screen.findByRole('heading', { level: 1, name: 'v1.2 改造笔记' })).toBeInTheDocument()
  })

  it('草稿笔记或不可见项目下的笔记返回 404 文案', async () => {
    const draft = admin('POST', '/admin/notes', {
      project_id: 'proj_portfolio',
      slug: 'draft-demo',
      title: '草稿笔记',
      body_md: '未发布',
      publish_status: 'draft',
    })
    expect(draft.status).toBe(201)

    for (const slug of ['draft-demo', 'archived-note']) {
      const router = makeRouter(`/notes/${slug}`)
      await router.isReady()
      const { unmount } = render(NoteDetailView, { props: { slug }, global: { plugins: [router] } })
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('不存在'))
      unmount()
    }
  })
})

describe('NoteDetailView · 门槛与 a11y', () => {
  beforeEach(() => resetMockDb())

  it('超过 100 篇时（真的造 101 篇）选中笔记落在窗外，上下篇区给说明与回列表入口', async () => {
    // 契约 §3.3 的口径是「最近 100 篇」：这里造满 101 篇，把种子笔记挤出窗口，
    // 不靠「列表内相邻」的等价物近似。
    for (let i = 0; i < 101; i += 1) {
      const created = admin('POST', '/admin/notes', {
        project_id: 'proj_chart',
        slug: `bulk-${i}`,
        title: `批量笔记 ${i}`,
        body_md: '批量正文',
        publish_status: 'published',
      })
      expect(created.status).toBe(201)
    }
    const listed = await listPublicNotes({ page: 1, pageSize: 100 })
    expect(listed.items).toHaveLength(100)
    expect(listed.total).toBeGreaterThanOrEqual(101)

    await renderNote('chart-kit-0-9')
    await screen.findByRole('heading', { level: 1, name: 'Chart Kit 0.9 发布说明' })

    const hint = await screen.findByText(/这篇笔记较早，未在最近 100 篇内/)
    expect(hint).toBeInTheDocument()
    expect(within(hint).getByRole('link', { name: '回笔记列表' })).toHaveAttribute('href', '/notes')
  })

  it('目录当前项跟着滚动走：滚过第二条标题后它成为 aria-current', async () => {
    admin('POST', '/admin/notes', {
      project_id: 'proj_portfolio',
      slug: 'toc-scroll',
      title: '带两节的笔记',
      body_md: '## 第一节\n\n内容。\n\n## 第二节\n\n更多内容。\n',
      publish_status: 'published',
    })
    await renderNote('toc-scroll')

    const toc = await screen.findByRole('region', { name: '本页目录' })
    await waitFor(() => expect(within(toc).getAllByRole('link')).toHaveLength(2))
    const links = within(toc).getAllByRole('link')

    // jsdom 不会真的滚动：直接改每个标题的 top，模拟「第二条已滚过顶部」
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('.markdown h2, .markdown h3'),
    )
    headings.forEach((heading, i) => {
      heading.getBoundingClientRect = () => ({ top: i === 0 ? -200 : 40 }) as DOMRect
    })
    window.dispatchEvent(new Event('scroll'))

    await waitFor(() => expect(links[links.length - 1]).toHaveAttribute('aria-current', 'location'))
    expect(links[0]).not.toHaveAttribute('aria-current')
  })

  it('所属项目卡补上项目摘要与进展徽标（✓ 已上线）', async () => {
    await renderNote('chart-kit-0-9')

    const panel = await screen.findByRole('region', { name: '所属项目' })
    const card = within(panel).getByRole('link')
    // 摘要来自再取一次项目详情；chart-kit 是已上线，所以徽标是 check 形态
    await waitFor(() => expect(card).toHaveTextContent('声明式图表库'))
    expect(within(card).getByText('已上线')).toBeInTheDocument()
  })

  it('正文标题可聚焦、目录锚点目标带 tabindex，切换后有 aria-live 播报区', async () => {
    const created = admin('POST', '/admin/notes', {
      project_id: 'proj_portfolio',
      slug: 'toc-note',
      title: '带目录的笔记',
      body_md: '## 第一节\n\n正文一。\n\n### 小节\n\n正文二。\n\n## 第二节\n\n正文三。',
      publish_status: 'published',
    })
    expect(created.status).toBe(201)

    await renderNote('toc-note')
    const title = await screen.findByRole('heading', { level: 1, name: '带目录的笔记' })
    expect(title).toHaveAttribute('tabindex', '-1')

    await waitFor(() =>
      expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#')).length).toBeGreaterThan(0),
    )
    const tocLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#'))
    for (const link of tocLinks) {
      const id = link.getAttribute('href')!.slice(1)
      expect(document.getElementById(id)).toHaveAttribute('tabindex', '-1')
    }
    expect(document.querySelector('aside[aria-live="polite"]')).not.toBeNull()
  })

  it('旧 slug 301 后把地址栏收敛到规范 slug', async () => {
    const router = await renderNote('v1-2-notes-old')
    await screen.findByRole('heading', { level: 1, name: 'v1.2 改造笔记' })
    await waitFor(() => expect(router.currentRoute.value.params.slug).toBe('v1-2-notes'))
  })
})
