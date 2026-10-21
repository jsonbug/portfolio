import { render, screen } from '@testing-library/vue'
import { createRouter, createWebHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import ProjectDetailView from './ProjectDetailView.vue'

function renderDetail(slug: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/projects/:slug', name: 'project-detail', component: ProjectDetailView, props: true },
    ],
  })
  return render(ProjectDetailView, { props: { slug }, global: { plugins: [router] } })
}

describe('ProjectDetailView', () => {
  beforeEach(() => resetMockDb())

  it('渲染项目名、简介、链接与固定元数据', async () => {
    renderDetail('portfolio-platform')
    expect(await screen.findByRole('heading', { name: '项目展示平台' })).toBeInTheDocument()
    expect(
      screen.getByText('把散落在收藏夹里的项目收进一个可检索、可记笔记的展示站。'),
    ).toBeInTheDocument()
    // 链接按 label 渲染（repo → GitHub）
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '官网' })).toBeInTheDocument()
    // 固定列：角色 / 版本 / 许可
    expect(screen.getByText('前端负责人')).toBeInTheDocument()
    expect(screen.getByText('1.4.0')).toBeInTheDocument()
    expect(screen.getByText('MIT')).toBeInTheDocument()
  })

  it('渲染 Markdown 描述、自定义元数据与笔记列表', async () => {
    renderDetail('portfolio-platform')
    expect(await screen.findByText(/一页看清每个项目的进展/)).toBeInTheDocument()
    expect(screen.getByText('代码行数')).toBeInTheDocument()
    expect(screen.getByText('18k')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByText('v1.2 改造笔记')).toBeInTheDocument()
    // 草稿笔记不进前台
    expect(screen.queryByText('（草稿）下一轮想做的事')).not.toBeInTheDocument()
  })

  it('旧 slug 301 后仍能渲染（mock 跟随重定向）', async () => {
    renderDetail('multica-demo')
    expect(await screen.findByRole('heading', { name: '项目展示平台' })).toBeInTheDocument()
  })

  it('未公开项目返回 404 文案，不泄露存在性', async () => {
    for (const slug of ['draft-idea', 'old-blog', 'deleted-tool']) {
      const { unmount } = renderDetail(slug)
      expect(await screen.findByRole('alert')).toHaveTextContent('不存在')
      unmount()
    }
  })
})
