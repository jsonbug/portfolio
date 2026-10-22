import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import AdminLayout from './AdminLayout.vue'

async function renderLayout(initial = '/admin/projects') {
  setActivePinia(createPinia())
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', name: 'admin-login', component: { template: '<div>login</div>' } },
      {
        path: '/admin',
        component: AdminLayout,
        children: [
          { path: 'projects', name: 'admin-projects', component: { template: '<div>list</div>' } },
          { path: 'projects/new', name: 'admin-project-new', component: { template: '<div>new</div>' } },
          { path: 'notes', name: 'admin-notes', component: { template: '<div>notes</div>' } },
          {
            path: 'notes/:id',
            name: 'admin-note-edit',
            component: { template: '<div>note edit</div>' },
            props: true,
          },
          { path: 'notes/new', name: 'admin-note-new', component: { template: '<div>note</div>' } },
        ],
      },
    ],
  })
  await router.push(initial)
  await router.isReady()
  render({ template: '<RouterView />' }, { global: { plugins: [router] } })
  return router
}

describe('AdminLayout 侧栏（03 稿）', () => {
  it('三项都带内联图标（装饰性、不进可访问名）', async () => {
    await renderLayout()
    const nav = await screen.findByRole('navigation', { name: '后台导航' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      '项目列表',
      '笔记',
      '新建项目',
      '新建笔记',
    ])
    for (const link of links) {
      const icon = link.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
    }
  })

  it('当前项有 router-link-active（浅蓝底 + 主色字的样式钩子）', async () => {
    await renderLayout('/admin/projects')
    const nav = await screen.findByRole('navigation', { name: '后台导航' })
    const active = within(nav).getAllByRole('link').filter((link) => link.classList.contains('router-link-active'))
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('项目列表')
  })

  it('「笔记」在列表页与编辑器页都高亮（两条不同的路由记录）', async () => {
    for (const path of ['/admin/notes', '/admin/notes/note_x1']) {
      document.body.innerHTML = ''
      await renderLayout(path)
      const nav = await screen.findByRole('navigation', { name: '后台导航' })
      const highlighted = within(nav)
        .getAllByRole('link')
        .filter((link) => link.className.includes('nav-link--active'))
      expect(highlighted).toHaveLength(1)
      expect(highlighted[0]).toHaveTextContent('笔记')
    }
  })

  it('退出登录清掉令牌并回登录页', async () => {
    localStorage.setItem('portfolio.admin.token', 'mock-token-test')
    const router = await renderLayout()
    await fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(localStorage.getItem('portfolio.admin.token')).toBeNull()
    await waitFor(() => expect(router.currentRoute.value.name).toBe('admin-login'))
  })
})
