/**
 * 契约表的 **mock runner**：把 `test/contract/run.mjs` 里那张用例表原样灌进 `mocks/handlers`。
 *
 * 为什么这么做：`mocks/handlers.ts` 是手写的契约副本，如果只对真后端跑一遍、再口头上说一句
 * 「mock 与真实后端同构」，那是声明不是验证。这里让两个 runner 产出**同名同序的行**，
 * `npm run contract -- --source both` 逐行 diff，同构就是被验出来的结论。
 *
 * 单独跑：`npx vitest run src/mocks/contract-bridge.spec.ts`
 */
import { describe, expect, it } from 'vitest'
import { handleMockRequest, resetMockDb } from '@/mocks/handlers'

interface ContractRow {
  section: string
  name: string
  kind: 'must' | 'todo'
  satisfied: boolean
  todo?: string
  note: string
}

interface PlanModule {
  runPlan: (opts: {
    transport: (
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<{ status: number; headers: Headers; json: unknown }>
    username?: string
    password?: string
    runId?: string
  }) => Promise<ContractRow[]>
}

/**
 * 与 `api()` 同签名的 mock 传输层。
 *
 * 用 `handleMockRequest` 而不是 `mockFetch`：后者会像浏览器一样自动跟随 301，
 * 而契约行要验的正是「原始 301 + Location」，跟随了就等于把这条断言吃掉。
 */
const mockTransport = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) => {
  const url = new URL(`http://mock.local/api/v1${path}`)
  const res = handleMockRequest({
    method,
    path: url.pathname.replace(/^\/api\/v1/, ''),
    query: url.searchParams,
    headers,
    body: body ? JSON.parse(JSON.stringify(body)) : undefined,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, headers: res.headers, json }
}

describe('契约表的 mock runner', () => {
  it('同一张表在 mock 上跑一遍，并产出可比对的行', async () => {
    resetMockDb()
    // 同一张表：直接复用 CLI 那份 run.mjs（不是另抄一份期望值）
    // @ts-expect-error 该模块是给 node 跑的 .mjs，不带类型声明
    const { runPlan } = (await import('../../test/contract/run.mjs')) as PlanModule
    const rows = await runPlan({
      transport: mockTransport,
      // mock 的账号是 handlers 里的 admin/admin123，与真实后端的 integration-pass 不同
      username: 'admin',
      password: 'admin123',
      runId: 'mockrun',
    })

    const out = process.env.CONTRACT_ROWS_OUT
    if (out) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(out, JSON.stringify(rows), 'utf8')
    }

    // mock 是契约的本地实现：除了显式标注「等后端合」的行，其余都必须满足契约
    const mustFailures = rows.filter((row) => row.kind === 'must' && !row.satisfied)
    expect(mustFailures.map((row) => row.name)).toEqual([])
    expect(rows.length).toBeGreaterThan(50)
  }, 120_000)
})
