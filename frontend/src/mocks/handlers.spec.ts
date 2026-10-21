/**
 * 冻结契约（docs/api-contract.md v1.2）的可执行规格。
 *
 * 这些用例是「契约即测试」：前端 api/mock 与真实后端须同时满足；
 * 任何一条改动都需要先改契约文档。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AdminNoteDetail,
  AdminProjectDetail,
  AdminProjectListItem,
  Link,
  NoteDetail,
  ProjectDetail,
  ProjectListEnvelope,
} from '@/types'
import { handleMockRequest, mockFetch, resetMockDb, type MockRequest } from './handlers'

const TOKEN = 'mock-token-test'

interface CallOptions {
  query?: Record<string, string | string[] | undefined>
  body?: unknown
  token?: string | null
}

function call(method: string, path: string, options: CallOptions = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v))
    else query.append(key, value)
  }
  const token = options.token === undefined ? TOKEN : options.token
  const req: MockRequest = {
    method,
    path,
    query,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: options.body,
  }
  return handleMockRequest(req)
}

async function bodyOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

beforeEach(() => resetMockDb())

describe('公开项目列表 GET /projects', () => {
  it('只返回 published 且未软删除的项目，并给出分段计数', async () => {
    const res = call('GET', '/projects')
    expect(res.status).toBe(200)
    const data = await bodyOf<ProjectListEnvelope>(res)

    expect(data.total).toBe(3)
    expect(data.items.map((i) => i.slug).sort()).toEqual([
      'chart-kit',
      'crawler-tools',
      'portfolio-platform',
    ])
    expect(data.counts).toEqual({ all: 3, ongoing: 2, launched: 1 })
    // 列表项不含曝光状态与软删除标记
    expect(data.items[0]).not.toHaveProperty('publish_status')
    expect(data.items[0]).not.toHaveProperty('deleted_at')
  })

  it('counts 在 progress 过滤之前统计', async () => {
    const data = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { progress: 'launched' } }),
    )
    expect(data.total).toBe(1)
    expect(data.items[0].slug).toBe('chart-kit')
    // 分段计数仍为全集（保证 tab 数字稳定）
    expect(data.counts).toEqual({ all: 3, ongoing: 2, launched: 1 })
  })

  it('search 匹配名称与简介（大小写不敏感）', async () => {
    const data = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { search: 'CHART' } }),
    )
    expect(data.total).toBe(1)
    expect(data.items[0].slug).toBe('chart-kit')
  })

  it('technology 支持重复参数与逗号分隔两种写法，命中任一即匹配', async () => {
    const repeated = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { technology: ['Vue 3', 'Python'] } }),
    )
    expect(repeated.items.map((i) => i.slug).sort()).toEqual([
      'crawler-tools',
      'portfolio-platform',
    ])

    const csv = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { technology: 'Vue 3,Python' } }),
    )
    expect(csv.items.map((i) => i.slug).sort()).toEqual(['crawler-tools', 'portfolio-platform'])
  })

  it('technology 不跨项目取并集（命中即算，不要求同时包含）', async () => {
    const data = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { technology: 'vue 3' } }),
    )
    expect(data.items.map((i) => i.slug)).toEqual(['portfolio-platform'])
  })

  it('sort=stars 按 star 降序，recent 按更新时间降序', async () => {
    const stars = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { sort: 'stars' } }),
    )
    expect(stars.items.map((i) => i.slug)).toEqual([
      'chart-kit',
      'portfolio-platform',
      'crawler-tools',
    ])

    const recent = await bodyOf<ProjectListEnvelope>(call('GET', '/projects', { query: {} }))
    expect(recent.items[0].slug).toBe('portfolio-platform')
  })

  it('分页参数被夹到合法范围', async () => {
    const data = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { page: '2', pageSize: '2' } }),
    )
    expect(data.items).toHaveLength(1)
    expect(data.page).toBe(2)
    expect(data.pageSize).toBe(2)

    const clamped = await bodyOf<ProjectListEnvelope>(
      call('GET', '/projects', { query: { page: '0', pageSize: '999' } }),
    )
    expect(clamped.page).toBe(1)
    expect(clamped.pageSize).toBe(100)
  })
})

describe('公开项目详情 GET /projects/{slug}', () => {
  it('返回详情：链接按 sort 排序、元数据有序、笔记只含已发布', async () => {
    const data = await bodyOf<ProjectDetail>(call('GET', '/projects/portfolio-platform'))
    expect(data.name).toBe('项目展示平台')
    expect(data.progress).toBe('ongoing')
    expect(data.links.map((l) => l.type)).toEqual(['repo', 'site'])
    expect(data.metadata.map((m) => m.key_label)).toEqual(['代码行数', '测试用例'])
    expect(data.notes.map((n) => n.slug).sort()).toEqual(['v1-2-notes', 'why-mock-first'])
    expect(data.notes.every((n) => n.published_at !== null)).toBe(true)
  })

  it('旧 slug 返回 301 + Location，客户端跟随到新 slug', async () => {
    const res = call('GET', '/projects/multica-demo')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/api/v1/projects/portfolio-platform')

    const followed = await mockFetch('http://localhost/api/v1/projects/multica-demo')
    expect(followed.status).toBe(200)
    expect((await bodyOf<ProjectDetail>(followed)).slug).toBe('portfolio-platform')
  })

  it('草稿 / 已归档 / 软删除一律 404（不泄露存在性）', async () => {
    for (const slug of ['draft-idea', 'old-blog', 'deleted-tool']) {
      const res = call('GET', `/projects/${slug}`)
      expect(res.status, slug).toBe(404)
      const err = await bodyOf<{ error: { code: string } }>(res)
      expect(err.error.code).toBe('NOT_FOUND')
    }
  })
})

describe('公开技术与笔记', () => {
  it('GET /technologies 只聚合前台可见项目，去重升序', async () => {
    const data = await bodyOf<{ items: string[] }>(call('GET', '/technologies'))
    expect(data.items).toContain('Vue 3')
    expect(data.items).not.toContain('Rust') // 草稿项目
    expect(data.items).not.toContain('Go') // 软删除项目
    expect(data.items).not.toContain('Hugo') // 已归档项目
    expect([...data.items]).toEqual([...data.items].sort((a, b) => a.localeCompare(b)))
  })

  it('GET /notes 只返回公开项目下的已发布笔记', async () => {
    const data = await bodyOf<{ items: Array<{ slug: string }>; total: number }>(call('GET', '/notes'))
    const slugs = data.items.map((n) => n.slug)
    expect(slugs).not.toContain('draft-outline')
    expect(slugs).not.toContain('archived-note')
    expect(slugs).toContain('chart-kit-0-9')
    expect(data.total).toBe(slugs.length)
  })

  it('GET /notes/{slug} 返回详情，草稿笔记 404', async () => {
    const detail = await bodyOf<NoteDetail>(call('GET', '/notes/v1-2-notes'))
    expect(detail.title).toBe('v1.2 改造笔记')
    expect(detail.project.slug).toBe('portfolio-platform')

    expect(call('GET', '/notes/draft-outline').status).toBe(404)
  })
})

describe('鉴权', () => {
  it('后台接口无 token 返回 401 UNAUTHORIZED', async () => {
    const res = call('GET', '/admin/projects', { token: null })
    expect(res.status).toBe(401)
    expect((await bodyOf<{ error: { code: string } }>(res)).error.code).toBe('UNAUTHORIZED')
  })

  it('登录成功下发 token，失败 401', async () => {
    const okRes = call('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } })
    expect(okRes.status).toBe(200)
    const { token, expiresAt } = await bodyOf<{ token: string; expiresAt: string }>(okRes)
    expect(token).toMatch(/^mock-token-/)
    expect(Number.isNaN(Date.parse(expiresAt))).toBe(false)

    const bad = call('POST', '/auth/login', { body: { username: 'admin', password: 'x' } })
    expect(bad.status).toBe(401)
  })
})

describe('后台项目 GET/POST /admin/projects', () => {
  it('默认排除软删除项目，includeDeleted=true 时包含', async () => {
    const normal = await bodyOf<{ items: AdminProjectListItem[]; total: number }>(
      call('GET', '/admin/projects'),
    )
    expect(normal.items.map((i) => i.slug)).not.toContain('deleted-tool')

    const withDeleted = await bodyOf<{ items: AdminProjectListItem[] }>(
      call('GET', '/admin/projects', { query: { includeDeleted: 'true' } }),
    )
    expect(withDeleted.items.map((i) => i.slug)).toContain('deleted-tool')
    // 后台列表项含曝光状态 + 软删除标记
    expect(withDeleted.items[0]).toHaveProperty('publish_status')
    expect(withDeleted.items[0]).toHaveProperty('deleted_at')
  })

  it('支持 publish_status / progress / search 过滤', async () => {
    const drafts = await bodyOf<{ items: AdminProjectListItem[] }>(
      call('GET', '/admin/projects', { query: { publish_status: 'draft' } }),
    )
    expect(drafts.items.map((i) => i.slug)).toEqual(['draft-idea'])

    const launched = await bodyOf<{ items: AdminProjectListItem[] }>(
      call('GET', '/admin/projects', { query: { progress: 'launched' } }),
    )
    expect(launched.items.map((i) => i.slug).sort()).toEqual(['chart-kit', 'old-blog'])

    const searched = await bodyOf<{ items: AdminProjectListItem[] }>(
      call('GET', '/admin/projects', { query: { search: '草稿' } }),
    )
    expect(searched.items.map((i) => i.slug)).toEqual(['draft-idea'])
  })

  it('创建：201 + 默认草稿；非法 slug 400；重名 409', async () => {
    const created = call('POST', '/admin/projects', {
      body: { slug: 'new-proj', name: '新项目' },
    })
    expect(created.status).toBe(201)
    const detail = await bodyOf<AdminProjectDetail>(created)
    expect(detail.publish_status).toBe('draft')
    expect(detail.progress).toBe('ongoing')
    expect(detail.deleted_at).toBeNull()

    const badSlug = call('POST', '/admin/projects', { body: { slug: 'Bad Slug', name: 'x' } })
    expect(badSlug.status).toBe(400)
    expect((await bodyOf<{ error: { code: string } }>(badSlug)).error.code).toBe('VALIDATION_ERROR')

    const conflict = call('POST', '/admin/projects', {
      body: { slug: 'portfolio-platform', name: '重名' },
    })
    expect(conflict.status).toBe(409)
  })

  it('创建：name 缺失 400，且返回字段级 details', async () => {
    const res = call('POST', '/admin/projects', { body: { slug: 'no-name' } })
    expect(res.status).toBe(400)
    const err = await bodyOf<{ error: { details?: Array<{ field: string }> } }>(res)
    expect(err.error.details?.some((d) => d.field === 'name')).toBe(true)
  })
})

describe('后台项目 PATCH/DELETE/restore', () => {
  it('曝光状态走状态机：published→archived 允许，archived→draft 拒绝', async () => {
    const okRes = call('PATCH', '/admin/projects/proj_portfolio', {
      body: { publish_status: 'archived' },
    })
    expect(okRes.status).toBe(200)
    expect((await bodyOf<AdminProjectDetail>(okRes)).publish_status).toBe('archived')

    const badRes = call('PATCH', '/admin/projects/proj_old_blog', {
      body: { publish_status: 'draft' },
    })
    expect(badRes.status).toBe(400)
    expect((await bodyOf<{ error: { code: string } }>(badRes)).error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    )
  })

  it('首次发布写入 published_at，第二次发布不变', async () => {
    const first = await bodyOf<AdminProjectDetail>(
      call('PATCH', '/admin/projects/proj_draft_idea', { body: { publish_status: 'published' } }),
    )
    expect(first.published_at).not.toBeNull()

    await call('PATCH', '/admin/projects/proj_draft_idea', { body: { publish_status: 'draft' } })
    const again = await bodyOf<AdminProjectDetail>(
      call('PATCH', '/admin/projects/proj_draft_idea', { body: { publish_status: 'published' } }),
    )
    expect(again.published_at).toBe(first.published_at)
  })

  it('软删除幂等：DELETE 返回带 deleted_at 的详情，前台随即 404；restore 复原', async () => {
    const del = call('DELETE', '/admin/projects/proj_portfolio')
    expect(del.status).toBe(200)
    const deleted = await bodyOf<AdminProjectDetail>(del)
    expect(deleted.deleted_at).not.toBeNull()

    const again = await bodyOf<AdminProjectDetail>(call('DELETE', '/admin/projects/proj_portfolio'))
    expect(again.deleted_at).toBe(deleted.deleted_at)

    expect(call('GET', '/projects/portfolio-platform').status).toBe(404)

    const restored = await bodyOf<AdminProjectDetail>(
      call('POST', '/admin/projects/proj_portfolio/restore'),
    )
    expect(restored.deleted_at).toBeNull()
    expect(call('GET', '/projects/portfolio-platform').status).toBe(200)
  })

  it('PATCH 软删除项目仍可写（后台可见即可改）', async () => {
    const res = call('PATCH', '/admin/projects/proj_deleted_tool', { body: { name: '改名' } })
    expect(res.status).toBe(200)
  })
})

describe('自定义元数据 PUT /admin/projects/{id}/metadata', () => {
  it('整体替换并以数组顺序作为 sort', async () => {
    const res = call('PUT', '/admin/projects/proj_chart/metadata', {
      body: {
        items: [
          { key_label: '包体', value: '30KB' },
          { key_label: '覆盖率', value: '92%' },
        ],
      },
    })
    expect(res.status).toBe(200)
    const detail = await bodyOf<AdminProjectDetail>(res)
    expect(detail.metadata.map((m) => m.key_label)).toEqual(['包体', '覆盖率'])
    expect(detail.metadata.map((m) => m.sort)).toEqual([0, 1])
  })

  it('键名重复 400，超过 50 条 400', async () => {
    const dup = call('PUT', '/admin/projects/proj_chart/metadata', {
      body: {
        items: [
          { key_label: '包体', value: 'a' },
          { key_label: '包体', value: 'b' },
        ],
      },
    })
    expect(dup.status).toBe(400)

    const many = call('PUT', '/admin/projects/proj_chart/metadata', {
      body: { items: Array.from({ length: 51 }, (_, i) => ({ key_label: `k${i}`, value: 'v' })) },
    })
    expect(many.status).toBe(400)
  })

  it('items 非数组 400', async () => {
    const res = call('PUT', '/admin/projects/proj_chart/metadata', { body: { items: 'x' } })
    expect(res.status).toBe(400)
  })
})

describe('链接 /admin/links', () => {
  it('创建 201、排序与标签可改、删除 204', async () => {
    const created = call('POST', '/admin/projects/proj_crawler/links', {
      body: { type: 'docs', label: '文档', url: 'https://crawler.example.com/docs', sort: 1 },
    })
    expect(created.status).toBe(201)
    const link = await bodyOf<Link>(created)
    expect(link.type).toBe('docs')

    const patched = await bodyOf<Link>(
      call('PATCH', `/admin/links/${link.id}`, { body: { label: '使用手册', sort: 0 } }),
    )
    expect(patched.label).toBe('使用手册')
    expect(patched.sort).toBe(0)

    const del = call('DELETE', `/admin/links/${link.id}`)
    expect(del.status).toBe(204)
    expect(call('DELETE', `/admin/links/${link.id}`).status).toBe(404)
  })

  it('非法 URL 400、非法类型 400', async () => {
    expect(
      call('POST', '/admin/projects/proj_crawler/links', { body: { url: 'ftp://x' } }).status,
    ).toBe(400)
    expect(
      call('POST', '/admin/projects/proj_crawler/links', {
        body: { url: 'https://ok.example.com', type: 'blog' },
      }).status,
    ).toBe(400)
  })
})

describe('笔记后台 /admin/notes（N:1）', () => {
  it('按项目过滤列表', async () => {
    const data = await bodyOf<{ items: Array<{ project_id: string }> }>(
      call('GET', '/admin/notes', { query: { project_id: 'proj_chart' } }),
    )
    expect(data.items).toHaveLength(1)
    expect(data.items[0].project_id).toBe('proj_chart')
  })

  it('创建 201；project_id 不存在 404；slug 重复 409', async () => {
    const created = call('POST', '/admin/notes', {
      body: {
        project_id: 'proj_chart',
        slug: 'chart-1-0',
        title: '1.0 发布',
        body_md: '## 内容',
      },
    })
    expect(created.status).toBe(201)
    const detail = await bodyOf<AdminNoteDetail>(created)
    expect(detail.publish_status).toBe('draft')

    expect(
      call('POST', '/admin/notes', {
        body: { project_id: 'nope', slug: 'x-1', title: 't', body_md: 'b' },
      }).status,
    ).toBe(404)

    expect(
      call('POST', '/admin/notes', {
        body: { project_id: 'proj_chart', slug: 'chart-1-0', title: 't', body_md: 'b' },
      }).status,
    ).toBe(409)
  })

  it('必填校验：title/body_md/project_id 缺失 400', async () => {
    const res = call('POST', '/admin/notes', { body: { slug: 'only-slug' } })
    expect(res.status).toBe(400)
    const err = await bodyOf<{ error: { details: Array<{ field: string }> } }>(res)
    const fields = err.error.details.map((d) => d.field)
    expect(fields).toEqual(expect.arrayContaining(['title', 'body_md', 'project_id']))
  })

  it('PATCH 改状态、DELETE 204 且随后 404', async () => {
    const list = await bodyOf<{ items: Array<{ id: string; slug: string }> }>(
      call('GET', '/admin/notes', { query: { project_id: 'proj_portfolio' } }),
    )
    const target = list.items.find((n) => n.slug === 'why-mock-first')
    expect(target, '种子笔记缺失').toBeTruthy()
    const noteId = target!.id

    const updated = await bodyOf<AdminNoteDetail>(
      call('PATCH', `/admin/notes/${noteId}`, { body: { publish_status: 'draft' } }),
    )
    expect(updated.publish_status).toBe('draft')

    // 笔记转草稿后前台立即不可见
    expect(call('GET', '/notes/why-mock-first').status).toBe(404)

    expect(call('DELETE', `/admin/notes/${noteId}`).status).toBe(204)
    expect(call('GET', `/admin/notes/${noteId}`).status).toBe(404)
  })
})

describe('错误信封与路由', () => {
  it('所有错误都是 { error: { code, message, requestId } }', async () => {
    const res = call('GET', '/projects/nope')
    expect(res.status).toBe(404)
    const payload = await bodyOf<{ error: Record<string, unknown> }>(res)
    expect(Object.keys(payload)).toEqual(['error'])
    expect(payload.error).toMatchObject({
      code: expect.any(String) as unknown as string,
      message: expect.any(String) as unknown as string,
      requestId: expect.any(String) as unknown as string,
    })
  })

  it('/health 与未知路由', async () => {
    expect(call('GET', '/health').status).toBe(200)
    expect(call('GET', '/nope').status).toBe(404)
    expect(call('GET', '/admin/nope').status).toBe(404)
  })

  it('mockFetch 兼容 /api/v1 前缀与相对 base', async () => {
    const res = await mockFetch('http://localhost/api/v1/projects?pageSize=1')
    expect(res.status).toBe(200)
    expect((await bodyOf<ProjectListEnvelope>(res)).items).toHaveLength(1)
  })
})
