/**
 * 回归断言：请求头契约。
 *
 * 历史的 47 个用例走 mock fetch，从不校验请求头，所以「无 body 请求带
 * Content-Type: application/json」被漏掉，真实后端对这类请求直接 400。
 * 这里把 mockFetch 替换为可捕获的 spy，断言真实发出的 headers。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface CapturedCall {
  url: string
  headers: Record<string, string>
  method: string
}

const calls: CapturedCall[] = []
const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    method: init?.method ?? 'GET',
  })
  return new Response(null, { status: 204 })
})

vi.mock('@/mocks', () => ({
  mockFetch: (input: RequestInfo | URL, init?: RequestInit) => fetchSpy(input, init),
}))

const { deleteProject, restoreProject, updateProject } = await import('./projects')
const { deleteLink, addLink } = await import('./links')
const { deleteNote, upsertNote } = await import('./notes')
const { getAuthToken, setAuthToken } = await import('./client')

function lastCall(): CapturedCall {
  const call = calls[calls.length - 1]
  expect(call, '未捕获到请求').toBeTruthy()
  return call
}

describe('request 请求头契约', () => {
  beforeEach(() => {
    calls.length = 0
    fetchSpy.mockClear()
  })

  afterEach(() => setAuthToken(null))

  it('DELETE 项目（无 body）不带 Content-Type', async () => {
    await deleteProject('p1')
    expect(lastCall().method).toBe('DELETE')
    expect(lastCall().headers).not.toHaveProperty('Content-Type')
  })

  it('恢复项目（POST 无 body）不带 Content-Type', async () => {
    await restoreProject('p1')
    expect(lastCall().method).toBe('POST')
    expect(lastCall().headers).not.toHaveProperty('Content-Type')
  })

  it('DELETE 链接（无 body）不带 Content-Type', async () => {
    await deleteLink('l1')
    expect(lastCall().method).toBe('DELETE')
    expect(lastCall().headers).not.toHaveProperty('Content-Type')
  })

  it('DELETE 笔记（无 body）不带 Content-Type', async () => {
    await deleteNote('p1')
    expect(lastCall().method).toBe('DELETE')
    expect(lastCall().headers).not.toHaveProperty('Content-Type')
  })

  it('带 body 的请求仍带 Content-Type: application/json', async () => {
    await updateProject('p1', { name: 'x' })
    expect(lastCall().headers['Content-Type']).toBe('application/json')

    await addLink('p1', { type: 'repo', url: 'https://example.com' })
    expect(lastCall().headers['Content-Type']).toBe('application/json')

    await upsertNote('p1', { title: 't', content: 'c' })
    expect(lastCall().headers['Content-Type']).toBe('application/json')
  })

  it('有 token 时仍附带 Authorization', async () => {
    setAuthToken('token-abc')
    await deleteProject('p1')
    expect(getAuthToken()).toBe('token-abc')
    expect(lastCall().headers.Authorization).toBe('Bearer token-abc')
  })
})
