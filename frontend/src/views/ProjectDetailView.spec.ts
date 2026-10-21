import { render, screen } from '@testing-library/vue'
import { createRouter, createWebHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { getMockDb, resetMockDb } from '@/mocks/handlers'
import ProjectDetailView from './ProjectDetailView.vue'

function publishedId(): string {
  const project = getMockDb().projects.find((p) => p.status === 'published')
  expect(project, '种子数据缺少已发布项目').toBeTruthy()
  return project!.id
}

function renderDetail(id: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/projects/:id', name: 'project-detail', component: ProjectDetailView, props: true },
    ],
  })
  return render(ProjectDetailView, { props: { id }, global: { plugins: [router] } })
}

describe('ProjectDetailView', () => {
  beforeEach(() => resetMockDb())

  it('渲染项目名、简介与链接', async () => {
    renderDetail(publishedId())
    expect(await screen.findByRole('heading', { name: 'multica-demo' })).toBeInTheDocument()
    expect(screen.getByText('项目展示平台：记录我做过的项目、笔记与元数据')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub 仓库' })).toBeInTheDocument()
  })

  it('渲染 Markdown 描述与笔记标题', async () => {
    renderDetail(publishedId())
    expect(await screen.findByText(/一个个人项目展示平台/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /笔记/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /笔记 · multica-demo 开发笔记/ })).toBeInTheDocument()
  })
})
