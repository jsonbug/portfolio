import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import AppHeader from './AppHeader.vue'

function makeRouter(initial = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/notes', name: 'notes', component: { template: '<div>notes</div>' } },
      { path: '/admin/projects', name: 'admin-projects', component: { template: '<div>admin</div>' } },
    ],
  })
  void router.push(initial)
  return router
}

async function renderHeader(initial = '/') {
  const router = makeRouter(initial)
  await router.isReady()
  render(AppHeader, { global: { plugins: [router] } })
  return router
}

describe('AppHeader（01/03/07 稿共有件）', () => {
  it('顶栏三件套：搜索框、后台管理入口、头像都在，且都有可访问名', async () => {
    await renderHeader()

    expect(screen.getByRole('searchbox', { name: '搜索项目' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '后台管理' })).toHaveAttribute('href', '/admin/projects')
    expect(screen.getByRole('img', { name: /站长/ })).toHaveTextContent('DS')
  })

  it('顶栏搜索提交后跳到列表并把关键词写进 ?q=', async () => {
    const router = await renderHeader()
    const box = screen.getByRole('searchbox', { name: '搜索项目' })

    await fireEvent.update(box, '图表')
    await fireEvent.submit(box.closest('form') as HTMLFormElement)

    await waitFor(() => expect(router.currentRoute.value.query.q).toBe('图表'))
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('URL 里的 q 会回填到输入框（分享 / 后退后保持一致）', async () => {
    await renderHeader('/?q=抓取')
    expect(screen.getByRole('searchbox', { name: '搜索项目' })).toHaveValue('抓取')
  })
})
