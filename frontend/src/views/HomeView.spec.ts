import { render, screen } from '@testing-library/vue'
import { createRouter, createWebHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import HomeView from './HomeView.vue'

function renderHome() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/projects/:slug', name: 'project-detail', component: { template: '<div>detail</div>' } },
    ],
  })
  return render(HomeView, { global: { plugins: [router] } })
}

describe('HomeView', () => {
  beforeEach(() => resetMockDb())

  it('只渲染 published 且未软删除的项目', async () => {
    renderHome()
    // 三个已发布项目都在（卡片标题是 h2，页面 h1 也是「项目展示平台」）
    expect(await screen.findByRole('heading', { level: 2, name: 'Chart Kit' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '项目展示平台' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '抓取工具箱' })).toBeInTheDocument()
    // 草稿 / 已归档 / 软删除都不展示
    expect(screen.queryByRole('heading', { level: 2, name: '还没想好的东西' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '旧博客' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '被软删的工具' })).not.toBeInTheDocument()
  })

  it('前台不展示曝光状态（归档/草稿词不出现）', async () => {
    renderHome()
    await screen.findByRole('heading', { level: 2, name: 'Chart Kit' })
    expect(screen.queryByText('已归档')).not.toBeInTheDocument()
    expect(screen.queryByText('草稿')).not.toBeInTheDocument()
  })

  it('封面为空时以渐层兜底渲染（role=img）', async () => {
    renderHome()
    expect(await screen.findByRole('img', { name: '抓取工具箱 封面' })).toBeInTheDocument()
  })
})
