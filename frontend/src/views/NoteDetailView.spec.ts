import { render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
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

    const toc = await screen.findByRole('region', { name: '目录' })
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
