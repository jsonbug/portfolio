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
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div>detail</div>' } },
    ],
  })
  return render(HomeView, { global: { plugins: [router] } })
}

describe('HomeView', () => {
  beforeEach(() => resetMockDb())

  it('只渲染已发布项目（草稿/已下架不展示）', async () => {
    renderHome()
    expect(screen.getByRole('heading', { name: '项目展示平台' })).toBeInTheDocument()
    expect(await screen.findByText('multica-demo')).toBeInTheDocument()
    expect(screen.queryByText('chart-kit')).not.toBeInTheDocument()
    expect(screen.queryByText('old-crawler')).not.toBeInTheDocument()
  })

  it('封面为空时以渐层兜底渲染（role=img）', async () => {
    renderHome()
    expect(await screen.findByRole('img', { name: 'multica-demo 封面' })).toBeInTheDocument()
  })
})
