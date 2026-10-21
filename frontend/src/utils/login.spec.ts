import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ADMIN_PATH,
  LOGIN_ERROR_COPY,
  loginErrorMessage,
  safeRedirect,
} from './login'

describe('safeRedirect', () => {
  it('站内路径原样返回', () => {
    expect(safeRedirect('/admin/projects')).toBe('/admin/projects')
    expect(safeRedirect('/admin/projects/p1?tab=links')).toBe('/admin/projects/p1?tab=links')
  })

  it('缺省与非法类型回落到后台首页', () => {
    expect(safeRedirect(undefined)).toBe(DEFAULT_ADMIN_PATH)
    expect(safeRedirect(null)).toBe(DEFAULT_ADMIN_PATH)
    expect(safeRedirect(42)).toBe(DEFAULT_ADMIN_PATH)
    expect(safeRedirect('')).toBe(DEFAULT_ADMIN_PATH)
  })

  it('外跳形态一律拒绝', () => {
    for (const evil of [
      '//evil.com',
      'https://evil.com/x',
      'http://evil.com',
      'javascript:alert(1)',
      '/\\evil.com',
      'admin/projects', // 相对路径，无法判断基准
    ]) {
      expect(safeRedirect(evil)).toBe(DEFAULT_ADMIN_PATH)
    }
  })

  it('回跳登录页自身没有意义，回落到首页（避免登录成功又弹回登录页）', () => {
    expect(safeRedirect('/admin/login')).toBe(DEFAULT_ADMIN_PATH)
    expect(safeRedirect('/admin/login?redirect=/admin/projects')).toBe(DEFAULT_ADMIN_PATH)
  })

  it('数组参数取第一个（重复 query 的情形）', () => {
    expect(safeRedirect(['/admin/projects', '//evil.com'])).toBe('/admin/projects')
    expect(safeRedirect(['//evil.com', '/admin/projects'])).toBe(DEFAULT_ADMIN_PATH)
  })
})

describe('loginErrorMessage', () => {
  it('401 用「账号或密码不正确」，不区分账号是否存在', () => {
    expect(loginErrorMessage(401)).toBe(LOGIN_ERROR_COPY.credentials)
    expect(LOGIN_ERROR_COPY.credentials).toBe('账号或密码不正确')
  })

  it('429 走限流文案（契约目前无此码，先分流好，后端加上即生效）', () => {
    expect(loginErrorMessage(429)).toBe(LOGIN_ERROR_COPY.rateLimited)
  })

  it('网络异常（无状态码）与其他错误分别给兜底文案', () => {
    expect(loginErrorMessage(null)).toBe(LOGIN_ERROR_COPY.network)
    expect(loginErrorMessage(500)).toBe(LOGIN_ERROR_COPY.unknown)
    expect(loginErrorMessage(400)).toBe(LOGIN_ERROR_COPY.unknown)
  })

  it('文案里不出现账号/口令是否存在的暗示', () => {
    for (const copy of Object.values(LOGIN_ERROR_COPY)) {
      expect(copy).not.toMatch(/不存在|未注册|用户名错|账号错/)
    }
  })
})
