import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { login as apiLogin } from '@/api/auth'
import { getAuthToken, setAuthToken } from '@/api/client'

/** 后台登录态：token 持久化到 localStorage，登录/登出 + 是否已认证。 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getAuthToken())

  const isAuthenticated = computed(() => token.value !== null)

  async function login(username: string, password: string): Promise<void> {
    const res = await apiLogin({ username, password })
    token.value = res.token
    setAuthToken(res.token)
  }

  function logout(): void {
    token.value = null
    setAuthToken(null)
  }

  return { token, isAuthenticated, login, logout }
})
