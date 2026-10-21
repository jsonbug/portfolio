import { render, screen, within } from '@testing-library/vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleMockRequest, resetMockDb } from '@/mocks/handlers'
import ProjectDetailView from './ProjectDetailView.vue'

function renderDetail(slug: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/projects/:slug', name: 'project-detail', component: ProjectDetailView, props: true },
    ],
  })
  return render(ProjectDetailView, { props: { slug }, global: { plugins: [router] } })
}

const admin = (method: string, path: string, body?: unknown) =>
  handleMockRequest({
    method,
    path,
    query: new URLSearchParams(),
    headers: { authorization: 'Bearer mock-token-test' },
    body,
  })

/** 造一个「除了名字什么都没有」的已发布项目，用来验证空 panel 抑制。 */
async function seedBareProject(): Promise<void> {
  const created = admin('POST', '/admin/projects', { slug: 'bare-project', name: '极简项目' })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { id: string }
  expect(admin('PATCH', `/admin/projects/${body.id}`, { publish_status: 'published' }).status).toBe(200)
}

describe('ProjectDetailView', () => {
  beforeEach(() => resetMockDb())

  it('头部：名称、摘要、进展徽标与「star · 版本 · 更新时间」指标', async () => {
    renderDetail('portfolio-platform')

    expect(await screen.findByRole('heading', { level: 1, name: '项目展示平台' })).toBeInTheDocument()
    expect(screen.getByText('把散落在收藏夹里的项目收进一个可检索、可记笔记的展示站。')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('★ 128')).toBeInTheDocument()
    expect(screen.getByText('1.4.0')).toBeInTheDocument()
    expect(screen.getByText(/\d{4}-\d{2}-\d{2} 更新/)).toBeInTheDocument()
  })

  it('右栏三 panel：元数据（固定列 + 自定义 KV）/ 相关链接 / 技术栈', async () => {
    renderDetail('portfolio-platform')

    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    expect(within(aside).getByRole('heading', { name: '元数据' })).toBeInTheDocument()
    expect(within(aside).getByRole('heading', { name: '相关链接' })).toBeInTheDocument()
    expect(within(aside).getByRole('heading', { name: '技术栈' })).toBeInTheDocument()

    // 固定列
    expect(within(aside).getByText('前端负责人')).toBeInTheDocument()
    expect(within(aside).getByText('MIT')).toBeInTheDocument()
    // 自定义 KV
    expect(within(aside).getByText('代码行数')).toBeInTheDocument()
    expect(within(aside).getByText('18k')).toBeInTheDocument()
    // 技术栈
    expect(within(aside).getByText('Vue 3')).toBeInTheDocument()
  })

  it('相关链接：类型文案 + 裸域名 + 新窗口 rel', async () => {
    renderDetail('portfolio-platform')

    const link = await screen.findByRole('link', { name: /GitHub/ })
    expect(link).toHaveAttribute('href', 'https://github.com/jsonbug/portfolio')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('github.com')
    // 仓库 / 官网两类都在
    expect(screen.getByRole('link', { name: /官网/ })).toHaveTextContent('portfolio.example.com')
  })

  it('渲染 Markdown 介绍与相关笔记（草稿笔记不出现）', async () => {
    renderDetail('portfolio-platform')

    expect(await screen.findByText(/一页看清每个项目的进展/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '相关笔记' })).toBeInTheDocument()
    expect(screen.getByText('v1.2 改造笔记')).toBeInTheDocument()
    expect(screen.queryByText('（草稿）下一轮想做的事')).not.toBeInTheDocument()
  })

  it('空值不渲染：没有自定义 KV 就不出现那一行，且面板内只剩固定列', async () => {
    renderDetail('crawler-tools')

    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    const meta = within(aside).getByRole('heading', { name: '元数据' }).closest('section') as HTMLElement
    expect(within(meta).getByText('独立开发')).toBeInTheDocument()
    expect(within(meta).queryByText('代码行数')).not.toBeInTheDocument()
    // summary/description 为 null 时不出对应区块
    expect(screen.queryByRole('heading', { name: '项目介绍' })).not.toBeInTheDocument()
    // label 为空时回退成裸域名
    const repoLink = within(aside).getAllByRole('link')[0]
    expect(repoLink).toHaveAttribute('href', 'https://github.com/jsonbug/crawler-tools')
    expect(repoLink).toHaveTextContent('github.com')
  })

  it('三 panel 全空时整段 aside 与相关笔记都不渲染', async () => {
    await seedBareProject()
    renderDetail('bare-project')

    expect(await screen.findByRole('heading', { level: 1, name: '极简项目' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '项目速览' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '相关笔记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '项目介绍' })).not.toBeInTheDocument()
  })

  it('旧 slug 301 后仍能渲染（mock 跟随重定向）', async () => {
    renderDetail('multica-demo')
    expect(await screen.findByRole('heading', { level: 1, name: '项目展示平台' })).toBeInTheDocument()
  })

  it('未公开项目返回 404 文案，不泄露存在性', async () => {
    for (const slug of ['draft-idea', 'old-blog', 'deleted-tool']) {
      const { unmount } = renderDetail(slug)
      expect(await screen.findByRole('alert')).toHaveTextContent('不存在')
      unmount()
    }
  })
})
