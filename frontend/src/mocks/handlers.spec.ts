import { beforeEach, describe, expect, it } from 'vitest'
import { mockFetch, resetMockDb } from '@/mocks'

const TOKEN = 'Bearer mock-token-test'

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await mockFetch(path, init)
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? (JSON.parse(text) as unknown) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

function auth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: TOKEN } }
}

describe('mock 契约处理（handlers）', () => {
  beforeEach(() => resetMockDb())

  it('GET /health 返回 200 与状态字段', async () => {
    const { status, body } = await call('/api/v1/health')
    expect(status).toBe(200)
    expect(body).toMatchObject({ status: 'ok' })
  })

  it('前台项目列表只返回已发布项目，且带分页信封', async () => {
    const { status, body } = await call('/api/v1/projects')
    expect(status).toBe(200)
    const list = body as { items: Array<{ status: string }>; total: number }
    expect(list.total).toBe(1) // 种子仅 multica-demo 为 published
    expect(list.items).toHaveLength(1)
    expect(list.items[0].status).toBe('published')
    expect(list).toHaveProperty('page')
    expect(list).toHaveProperty('totalPages')
  })

  it('登录：正确凭据返回 mock token，错误凭据 401 UNAUTHORIZED', async () => {
    const ok = await call('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    expect(ok.status).toBe(200)
    expect((ok.body as { token: string }).token).toMatch(/^mock-token-/)

    const bad = await call('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    })
    expect(bad.status).toBe(401)
    expect((bad.body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED')
  })

  it('后台接口未带 token 返回 401', async () => {
    const { status } = await call('/api/v1/admin/projects')
    expect(status).toBe(401)
  })

  it('后台列表（不含已删除）返回全部三种状态', async () => {
    const { status, body } = await call('/api/v1/admin/projects', auth())
    expect(status).toBe(200)
    const list = body as { items: Array<{ status: string }>; total: number }
    expect(list.total).toBe(3)
    const statuses = list.items.map((i) => i.status).sort()
    expect(statuses).toEqual(['archived', 'draft', 'published'])
  })

  it('创建项目：缺 name 返回 400 VALIDATION_ERROR，合法返回 201', async () => {
    const bad = await call(
      '/api/v1/admin/projects',
      auth({ method: 'POST', body: JSON.stringify({ tagline: 'x' }) }),
    )
    expect(bad.status).toBe(400)
    const err = (bad.body as { error: { code: string; details: Array<{ field: string }> } }).error
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details[0].field).toBe('name')

    const good = await call(
      '/api/v1/admin/projects',
      auth({ method: 'POST', body: JSON.stringify({ name: '新项目' }) }),
    )
    expect(good.status).toBe(201)
    expect((good.body as { status: string }).status).toBe('draft')
  })

  it('软删除后可在 includeDeleted 列表看到 deletedAt，并支持恢复', async () => {
    const before = (await call('/api/v1/admin/projects', auth())).body as { items: Array<{ id: string }> }
    const id = before.items[0].id

    const del = await call(`/api/v1/admin/projects/${id}`, auth({ method: 'DELETE' }))
    expect(del.status).toBe(204)

    const after = (await call('/api/v1/admin/projects?includeDeleted=true', auth())).body as {
      items: Array<{ id: string; deletedAt: string | null }>
    }
    const row = after.items.find((i) => i.id === id)
    expect(row?.deletedAt).not.toBeNull()

    const restored = await call(`/api/v1/admin/projects/${id}/restore`, auth({ method: 'POST' }))
    expect(restored.status).toBe(200)
    expect((restored.body as { id: string; deletedAt: string | null }).deletedAt).toBeNull()
  })

  it('发布/下架状态机：跨级/回退迁移 400 INVALID_STATUS_TRANSITION，合法迁移与同状态 no-op 200', async () => {
    const list = (await call('/api/v1/admin/projects', auth())).body as {
      items: Array<{ id: string; status: string }>
    }
    const draft = list.items.find((i) => i.status === 'draft')
    const published = list.items.find((i) => i.status === 'published')
    expect(draft).toBeDefined()
    expect(published).toBeDefined()
    const id = draft!.id

    // 跨级：draft → archived 不允许
    const cross = await call(
      `/api/v1/admin/projects/${id}`,
      auth({ method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }),
    )
    expect(cross.status).toBe(400)
    expect((cross.body as { error: { code: string } }).error.code).toBe('INVALID_STATUS_TRANSITION')

    // 回退：published → draft 不允许
    const back = await call(
      `/api/v1/admin/projects/${published!.id}`,
      auth({ method: 'PATCH', body: JSON.stringify({ status: 'draft' }) }),
    )
    expect(back.status).toBe(400)
    expect((back.body as { error: { code: string } }).error.code).toBe('INVALID_STATUS_TRANSITION')

    // 合法：draft → published
    const okRes = await call(
      `/api/v1/admin/projects/${id}`,
      auth({ method: 'PATCH', body: JSON.stringify({ status: 'published' }) }),
    )
    expect(okRes.status).toBe(200)
    expect((okRes.body as { status: string }).status).toBe('published')

    // 同状态 no-op：published → published 不报错
    const noop = await call(
      `/api/v1/admin/projects/${id}`,
      auth({ method: 'PATCH', body: JSON.stringify({ status: 'published' }) }),
    )
    expect(noop.status).toBe(200)
  })
})
