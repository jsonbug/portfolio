import { describe, expect, it } from 'vitest'
import { bareDomain } from './link'

describe('bareDomain', () => {
  it('去掉协议、路径与 www 前缀', () => {
    expect(bareDomain('https://www.example.com/a/b?c=1')).toBe('example.com')
    expect(bareDomain('http://github.com/jsonbug/portfolio')).toBe('github.com')
  })

  it('保留端口', () => {
    expect(bareDomain('http://localhost:4310/api/v1')).toBe('localhost:4310')
  })

  it('非法 URL 原样返回', () => {
    expect(bareDomain('not a url')).toBe('not a url')
  })
})
