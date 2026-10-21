import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import LoginView from './LoginView.vue'

const TOKEN_KEY = 'portfolio.admin.token'

async function renderLogin(initialPath = '/admin/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', name: 'admin-login', component: LoginView },
      { path: '/admin/projects', name: 'admin-projects', component: { template: '<div>项目列表</div>' } },
      {
        path: '/admin/projects/:id',
        name: 'admin-project-edit',
        component: { template: '<div>编辑</div>' },
      },
    ],
  })
  await router.push(initialPath)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  return { router, ...render(LoginView, { global: { plugins: [pinia, router] } }) }
}

async function fillAndSubmit(username: string, password: string) {
  await fireEvent.update(screen.getByLabelText('账号'), username)
  await fireEvent.update(screen.getByLabelText('密码'), password)
  await fireEvent.click(screen.getByRole('button', { name: '登录' }))
}

describe('LoginView（D1）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMockDb()
  })

  it('渲染 D1 结构：品牌行 / 标题 / 副标题 / 两个字段 / 会话说明', async () => {
    await renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: '登录后台' })).toBeInTheDocument()
    expect(screen.getByText('仅站长可登录，前台无需账号。')).toBeInTheDocument()
    expect(screen.getByText('后台')).toBeInTheDocument()
    expect(screen.getByLabelText('账号')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByText('会话过期后需重新登录；退出后后台接口立即失效。')).toBeInTheDocument()
    // 稿里没有注册 / 忘记密码入口
    expect(screen.queryByText(/注册|忘记密码/)).toBeNull()
  })

  it('进入页面即聚焦「账号」，键盘可直接输入', async () => {
    await renderLogin()
    await waitFor(() => {
      expect(screen.getByLabelText('账号')).toHaveFocus()
    })
  })

  it('密码默认遮蔽，眼睛按钮可切换并在按钮上播报状态', async () => {
    await renderLogin()
    const password = screen.getByLabelText('密码') as HTMLInputElement
    expect(password.type).toBe('password')

    const toggle = screen.getByRole('button', { name: '显示密码' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await fireEvent.click(toggle)

    expect((screen.getByLabelText('密码') as HTMLInputElement).type).toBe('text')
    expect(screen.getByRole('button', { name: '隐藏密码' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('错误凭据：错误只挂密码字段，文案固定且不透露账号是否存在', async () => {
    await renderLogin()
    await fillAndSubmit('admin', 'wrong')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('账号或密码不正确')
    // 契约 §1.3：不区分「账号不存在」与「口令错误」
    expect(alert.textContent).not.toMatch(/不存在|未找到|用户名错误/)
    // 后端 message（含配置提示）不透传
    expect(alert.textContent).not.toMatch(/ADMIN_PASSWORD_HASH|环境变量/)

    // 错误挂在密码字段上，账号字段不受牵连
    const password = screen.getByLabelText('密码')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-describedby', 'login-error')
    expect(screen.getByLabelText('账号')).not.toHaveAttribute('aria-invalid')

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('重新输入即撤销错误态（不留旧错）', async () => {
    await renderLogin()
    await fillAndSubmit('admin', 'wrong')
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText('密码'), 'again')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
    expect(screen.getByLabelText('密码')).not.toHaveAttribute('aria-invalid')
  })

  it('正确凭据写入 token 并跳转默认页', async () => {
    const { router } = await renderLogin()
    await fillAndSubmit('admin', 'admin123')

    await waitFor(() => {
      expect(localStorage.getItem(TOKEN_KEY)).toMatch(/^mock-token-/)
    })
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('admin-projects')
    })
  })

  it('按 returnUrl 回跳原页面', async () => {
    const { router } = await renderLogin('/admin/login?redirect=/admin/projects/p1')
    await fillAndSubmit('admin', 'admin123')

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/admin/projects/p1')
    })
  })

  it('外站 redirect 一律回落到后台首页（含协议相对与反斜杠变体）', async () => {
    for (const evil of ['//evil.com/x', 'https://evil.com', '/\\evil.com', '/admin/login']) {
      localStorage.clear()
      resetMockDb()
      const { router, unmount } = await renderLogin(`/admin/login?redirect=${encodeURIComponent(evil)}`)
      await fillAndSubmit('admin', 'admin123')
      await waitFor(() => {
        expect(router.currentRoute.value.fullPath).toBe('/admin/projects')
      })
      unmount()
    }
  })

  it('加载中提交按钮不可重复触发', async () => {
    await renderLogin()
    await fireEvent.update(screen.getByLabelText('账号'), 'admin')
    await fireEvent.update(screen.getByLabelText('密码'), 'admin123')
    const submit = screen.getByRole('button', { name: '登录' })
    await fireEvent.click(submit)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /登录中/ })).toBeDisabled()
    })
  })
})
