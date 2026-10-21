import { afterEach, describe, expect, it, vi } from 'vitest'
import { login } from './auth'
import { getAuthToken, setAuthToken, setUnauthorizedHandler } from './client'
import { listAdminProjects } from './projects'

describe('client 401 全局拦截', () => {
  afterEach(() => {
    setAuthToken(null)
    setUnauthorizedHandler(null)
  })

  it('后台接口 401 时清 token 并触发跳转处理', async () => {
    // 非 mock-token-* 前缀 → mock 后台接口返回 401 UNAUTHORIZED
    setAuthToken('expired-token')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await expect(listAdminProjects({ includeDeleted: true })).rejects.toMatchObject({ status: 401 })

    expect(getAuthToken()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('登录接口自身 401（密码错）不触发全局跳转', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await expect(login({ username: 'admin', password: 'wrong-password' })).rejects.toMatchObject({
      status: 401,
    })

    expect(handler).not.toHaveBeenCalled()
  })
})
