import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import LoginView from './LoginView.vue'

const TOKEN_KEY = 'portfolio.admin.token'

function renderLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', name: 'admin-login', component: LoginView },
      { path: '/admin/projects', name: 'admin-projects', component: { template: '<div>projects</div>' } },
    ],
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  return { router, ...render(LoginView, { global: { plugins: [pinia, router] } }) }
}

describe('LoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMockDb()
  })

  it('渲染登录表单', () => {
    renderLogin()
    expect(screen.getByRole('heading', { name: /后台/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument()
    expect(screen.getByLabelText(/密码/)).toBeInTheDocument()
  })

  it('错误凭据显示错误提示', async () => {
    renderLogin()
    await fireEvent.update(screen.getByLabelText(/用户名/), 'admin')
    await fireEvent.update(screen.getByLabelText(/密码/), 'wrong')
    await fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('正确凭据写入 token 并跳转后台', async () => {
    const { router } = renderLogin()
    await fireEvent.update(screen.getByLabelText(/用户名/), 'admin')
    await fireEvent.update(screen.getByLabelText(/密码/), 'admin123')
    await fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(localStorage.getItem(TOKEN_KEY)).toMatch(/^mock-token-/)
    })
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('admin-projects')
    })
  })
})
