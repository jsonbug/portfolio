import { request } from './client'

export interface LoginPayload {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  expiresAt: string
}

/** 后台登录（契约 3.0：POST /auth/login → {token, expiresAt}）。 */
export function login(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
    skipAuthRedirect: true,
  })
}
