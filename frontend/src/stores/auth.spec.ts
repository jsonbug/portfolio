import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '@/mocks'
import { useAuthStore } from './auth'

const TOKEN_KEY = 'portfolio.admin.token'

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMockDb()
    setActivePinia(createPinia())
  })

  it('初始未登录', () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBeNull()
  })

  it('登录成功后写入 token 并持久化', async () => {
    const auth = useAuthStore()
    await auth.login('admin', 'admin123')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.token).toMatch(/^mock-token-/)
    expect(localStorage.getItem(TOKEN_KEY)).toBe(auth.token)
  })

  it('错误凭据抛出异常且不写入 token', async () => {
    const auth = useAuthStore()
    await expect(auth.login('admin', 'wrong')).rejects.toThrow()
    expect(auth.isAuthenticated).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('登出清空 token 与本地存储', async () => {
    const auth = useAuthStore()
    await auth.login('admin', 'admin123')
    auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
