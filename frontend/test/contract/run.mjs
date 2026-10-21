/**
 * 契约联调套件：**同一张用例表，两个 runner**（真实后端 / 前端 mock）。
 *
 * 为什么要有它：`frontend/src/mocks/handlers.ts` 是手写的契约副本。只说「守同构」不算数，
 * 所以这套断言被抽成可复用的行记录（rows），`--source real` 打真后端、`--source mock`
 * 把同一张表灌进 mock，`--source both` 逐行比对两者——同构是被**验出来**的，不是被声明的。
 *
 * 用法：
 *   cd backend && npx prisma migrate deploy && npx prisma generate
 *   PORT=4310 npx tsx src/index.ts          # 4310 被占就换端口，配 CONTRACT_BASE_URL
 *   cd frontend
 *   npm run contract                        # 只验真后端（默认）
 *   npm run contract -- --source mock       # 只验 mock
 *   npm run contract -- --source both       # 双向：同一张表两遍 + 逐行 diff
 *   npm run contract -- --strict            # 带 TODO 标注的行也算失败
 *
 * 环境变量：CONTRACT_BASE_URL（默认 http://127.0.0.1:4310/api/v1）
 *           CONTRACT_ADMIN_USERNAME / CONTRACT_ADMIN_PASSWORD（默认 admin / integration-pass）
 *
 * ⚠️ 脚本开头会打 `BASE` + `/health`，并用哨兵项目（写入→读回→软删）断言「打的确实是这套库」；
 *    随后软删库里所有既有项目，保证断言里的计数是确定的。只对本地 dev.db 用。
 */
const CONFIG = {
  base: process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:4310/api/v1',
  username: process.env.CONTRACT_ADMIN_USERNAME ?? 'admin',
  password: process.env.CONTRACT_ADMIN_PASSWORD ?? 'integration-pass',
}

/** 每次运行一组独立 slug：项目软删后 slug 仍被占用，重复跑不能撞 409。 */
let RUN = ''
let USERNAME = CONFIG.username
let PASSWORD = CONFIG.password
const slugOf = (name) => `${RUN}-${name}`
const DAY = 86_400_000
let token = ''

/** 传输层唯一注入点：真实后端用 fetch，mock 用 `mockFetch`。 */
let activeTransport = null

async function api(method, path, body) {
  if (!activeTransport) throw new Error('transport 未注入：用 runPlan() 跑，别直接调 api()')
  // 认证头由这里统一注入：两条 runner 走同一套鉴权语义，不靠各自实现碰运气
  const headers = {
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
  return activeTransport(method, path, body, headers)
}

function section(title) {
  currentSection = title
  console.log(`\n${title}`)
}

/** 用例行：两个 runner 产出同名同序的行，`--source both` 才能逐行比对。 */
const rows = []
let currentSection = ''

function record(row) {
  rows.push({ section: currentSection, note: '', ...row })
  const suffix = row.satisfied ? '' : ` — ${row.note}`
  console.log(`  ${row.satisfied ? '✓' : '✗'} ${row.name}${suffix}`)
}

/**
 * 契约必须满足；不满足即失败。
 *
 * 本表**只有这一种行**：曾经有过 `pendingBackend()`（"契约已定、后端未合"的 TODO 行），
 * 它今天零调用，但留着就是一条 abuse 通道——加一行就能标一打 TODO 绕过门禁。
 * 现在改为结构断言（见 `assertNoTodoRows`）：想加回 todo 行必须先删掉那条断言，删断言在 diff 里看得见。
 */
function check(name, cond, extra) {
  record({
    name,
    kind: 'must',
    satisfied: !!cond,
    note: cond ? '' : String(JSON.stringify(extra) ?? '').slice(0, 300),
  })
}

/**
 * 清场：**只软删本次 RUN 前缀的项目**，绝不发全局清理。
 *
 * 必须定义在模块顶层：CLI 的 `finally` 在 `runPlan` 之外调用它。
 * （曾经嵌在 `runPlan` 里，开头调用正常、收尾却 `ReferenceError`，只在 `--source both` 收尾才暴露。）
 */
async function cleanupRunProjects() {
  const existing = await api('GET', '/admin/projects?pageSize=100&includeDeleted=true')
  const mine = (existing.json?.items ?? []).filter((item) => item.slug.startsWith(`${RUN}-`))
  for (const item of mine) {
    if (!item.deleted_at) await api('DELETE', `/admin/projects/${item.id}`)
  }
  return mine.length
}

/** 结构性断言：整张表只能有 `kind === 'must'`。 */
function assertNoTodoRows(list) {
  const unexpected = list.filter((row) => row.kind !== 'must')
  if (unexpected.length) {
    console.error(
      `  ✗ 出现非 must 行（kind 只能是 'must'）：${unexpected.map((r) => `${r.kind}:${r.name}`).join(', ')}`,
    )
  }
  return unexpected.length === 0
}

/** 执行整张用例表。`transport` 决定打真后端还是 mock；返回行记录供 diff。 */
export async function runPlan(opts) {
  const { transport, username = CONFIG.username, password = CONFIG.password, runId } = opts
  activeTransport = transport
  USERNAME = username
  PASSWORD = password
  RUN = runId ?? `c${Date.now().toString(36)}`
  token = ''
  rows.length = 0
  currentSection = ''

  const login = await api('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
  if (login.status !== 200 || typeof login.json?.token !== 'string') {
    throw new Error(`登录失败（${login.status}）——后端是否已启动在 ${CONFIG.base}？`)
  }
  token = login.json.token

  // 身份自证：打的是哪套库、库是不是活的、写进去能不能读回来（默认端口撞车时最容易出假绿）
  section('环境自证 / 库身份')
  console.log(`  目标 BASE：${CONFIG.base}`)
  console.log(`  本次 RUN 前缀：${RUN}`)
  /**
   * 身份自证阶段的每一步都要「当场停」：下一步的哨兵写入、软删，以及之后的 resetProjects()
   * 都会对目标库发写操作。撞上别人的库时，多跑一步就是多碰一次别人的数据。
   * 退出码 3 与「断言失败(1)」「mock 取数失败(2)」区分开，流水线一眼能定位。
   */
  const bailIfFailed = (ok, step) => {
    if (ok) return
    console.error(`  ✗ 库身份自证失败（${step}）：立即中止，未发出任何清场请求`)
    process.exit(3)
  }
  const health = await api('GET', '/health')
  const healthOk = health.status === 200 && health.json?.status === 'ok'
  check('GET /health 返回 ok', healthOk, { status: health.status, body: health.json })
  bailIfFailed(healthOk, 'health')
  const sentinelSlug = slugOf('sentinel')
  const sentinel = await api('POST', '/admin/projects', { slug: sentinelSlug, name: `哨兵 ${RUN}` })
  const wrote = sentinel.status === 201
  check('哨兵项目写入成功（201）', wrote, sentinel.status)
  bailIfFailed(wrote, '哨兵写入')

  const sentinelBack = await api('GET', `/admin/projects/${sentinel.json?.id}`)
  const sameDb = sentinelBack.status === 200 && sentinelBack.json?.slug === sentinelSlug
  check('哨兵读回一致（同一套库，不是别人的端口）', sameDb, {
    status: sentinelBack.status,
    slug: sentinelBack.json?.slug,
  })
  // 读回不一致 = 打到了别人的库：此时连哨兵的软删都不发，直接退出（DELETE 计数必须为 0）
  bailIfFailed(sameDb, '哨兵读回')

  const sentinelGone = await api('DELETE', `/admin/projects/${sentinel.json?.id}`)
  const cleaned = sentinelGone.status === 200 && sentinelGone.json?.deleted_at != null
  check('哨兵软删成功', cleaned, sentinelGone.json?.deleted_at)
  bailIfFailed(cleaned, '哨兵软删')


// 清场逻辑见模块顶部的 `cleanupRunProjects`（CLI 收尾也要用，必须放顶层）。
// 代价是库里可能有别的 RUN 残留：计数断言因此全部改成「基线 + 本次增量」，见 `attachBaseline()`。

/** 清场后的公开面基线（别的 RUN 残留会一直存在，计数断言一律相对它）。 */
let baseline = { total: 0, counts: { all: 0, ongoing: 0, launched: 0 } }

async function attachBaseline() {
  const res = await api('GET', '/projects?pageSize=1')
  baseline = {
    total: res.json?.total ?? 0,
    counts: res.json?.counts ?? { all: 0, ongoing: 0, launched: 0 },
  }
  console.log(`  公开面基线：total=${baseline.total} counts=${JSON.stringify(baseline.counts)}（本次断言全部相对基线）`)
}

async function createProject(slug, patch = {}) {
  const created = await api('POST', '/admin/projects', { slug, name: patch.name ?? slug, ...patch })
  if (created.status !== 201) throw new Error(`create ${slug} → ${created.status} ${JSON.stringify(created.json)}`)
  return created.json
}

async function setStatus(id, publish_status) {
  const res = await api('PATCH', `/admin/projects/${id}`, { publish_status })
  if (res.status !== 200) throw new Error(`patch ${id} → ${res.status} ${JSON.stringify(res.json)}`)
  return res.json
}

await cleanupRunProjects()
await attachBaseline()

// ---------------------------------------------------------------- 项目：列表
section('项目列表 / 分段计数 / 搜索 / 技术栈 / 排序')

const portfolio = await createProject(slugOf('portfolio'), {
  name: '项目展示平台',
  summary: '把散落在收藏夹里的项目收进一个可检索的展示站。',
  progress: 'ongoing',
  stars: 128,
  version: '1.4.0',
  role: '前端负责人',
  license: 'MIT',
  start_year: 2024,
  team_size: 2,
  tech_stack: ['Vue 3', 'TypeScript', 'Vite'],
  last_updated_at: new Date(Date.now() - 2 * DAY).toISOString(),
})
await setStatus(portfolio.id, 'published')
await api('POST', `/admin/projects/${portfolio.id}/links`, {
  type: 'repo',
  url: 'https://github.com/jsonbug/portfolio',
  sort: 0,
})
await api('POST', `/admin/projects/${portfolio.id}/links`, {
  type: 'site',
  url: 'https://portfolio.example.com',
  sort: 1,
})

const chart = await createProject(slugOf('chart'), {
  name: 'Chart Kit',
  summary: '声明式图表库，包体 30KB 以内。',
  progress: 'launched',
  stars: 864,
  tech_stack: ['TypeScript', 'SVG'],
  last_updated_at: new Date(Date.now() - 40 * DAY).toISOString(),
})
await setStatus(chart.id, 'published')

const crawler = await createProject(slugOf('crawler'), {
  name: '抓取工具箱',
  progress: 'ongoing',
  stars: 12,
  tech_stack: ['Python'],
  last_updated_at: new Date(Date.now() - 7 * DAY).toISOString(),
})
await setStatus(crawler.id, 'published')

const blog = await createProject(slugOf('blog'), { name: '旧博客', progress: 'launched', tech_stack: ['Hugo'] })
await setStatus(blog.id, 'published')
await setStatus(blog.id, 'archived')

await createProject(slugOf('draft'), { name: '还没想好的东西', progress: 'ongoing', tech_stack: ['Rust'] })

const deleted = await createProject(slugOf('deleted'), { name: '被软删的工具', stars: 3, tech_stack: ['Go'] })
await setStatus(deleted.id, 'published')
const delRes = await api('DELETE', `/admin/projects/${deleted.id}`)
check('软删除返回详情且带 deleted_at', delRes.status === 200 && delRes.json?.deleted_at !== null, delRes.status)

const all = await api('GET', '/projects')
/** 只取本次 RUN 造的项目（库里可能有别的 RUN 残留，顺序断言必须只在自己这批上判）。 */
const mineOf = (res) => (res.json?.items ?? []).filter((i) => i.slug.startsWith(`${RUN}-`))

check('本次 3 个可见项目都在列表里', mineOf(all).length === 3, all.json?.items?.map((i) => i.slug))
check('total = 基线 + 本次 3 个', all.json?.total === baseline.total + 3, {
  total: all.json?.total,
  baseline: baseline.total,
})
check(
  'counts = 基线 + {all 3, ongoing 2, launched 1}',
  JSON.stringify(all.json?.counts) ===
    JSON.stringify({
      all: baseline.counts.all + 3,
      ongoing: baseline.counts.ongoing + 2,
      launched: baseline.counts.launched + 1,
    }),
  all.json?.counts,
)
check('软删项目不出现在列表', !JSON.stringify(all.json).includes(slugOf('deleted')))
check(
  '列表项不含曝光状态字段',
  !all.json?.items?.some((i) => 'publish_status' in i || 'deleted_at' in i || 'cover_source_url' in i),
  all.json?.items?.[0],
)
check(
  '列表项字段是 snake_case',
  all.json?.items?.every((i) => 'cover_image_url' in i && 'tech_stack' in i && 'last_updated_at' in i),
)
check(
  '默认按最近更新倒序',
  mineOf(all)
    .map((i) => i.slug)
    .join(',') === [slugOf('portfolio'), slugOf('crawler'), slugOf('chart')].join(','),
  mineOf(all).map((i) => i.slug),
)

const launched = await api('GET', '/projects?progress=launched')
check(
  'progress=launched 只留已上线',
  mineOf(launched).length === 1 && mineOf(launched)[0].slug === slugOf('chart'),
  mineOf(launched).map((i) => i.slug),
)
check('分段过滤后 counts 不变', JSON.stringify(launched.json?.counts) === JSON.stringify(all.json?.counts), launched.json?.counts)

const byName = await api('GET', `/projects?search=${encodeURIComponent('抓取')}`)
check(
  'search 命中名称',
  mineOf(byName)
    .map((i) => i.slug)
    .join(',') === slugOf('crawler'),
  byName.json?.items?.map((i) => i.slug),
)
const bySummary = await api('GET', `/projects?search=${encodeURIComponent('图表')}`)
check(
  'search 命中摘要',
  mineOf(bySummary)
    .map((i) => i.slug)
    .join(',') === slugOf('chart'),
  bySummary.json?.items?.map((i) => i.slug),
)
check(
  '搜索后 counts 与 total 同口径（都只算搜索结果）',
  bySummary.json?.counts?.all === bySummary.json?.total,
  { counts: bySummary.json?.counts, total: bySummary.json?.total },
)

const py = await api('GET', '/projects?technology=Python')
check('technology=Python 命中 1 个', mineOf(py).length === 1 && mineOf(py)[0].slug === slugOf('crawler'), mineOf(py).map((i) => i.slug))
const repeat = await api('GET', '/projects?technology=Vue%203&technology=SVG')
check('technology 重复参数 = 任一命中', mineOf(repeat).length === 2, mineOf(repeat).map((i) => i.slug))
const csv = await api('GET', '/projects?technology=Vue%203,SVG')
check('technology 逗号分隔等价值重复参数', mineOf(csv).length === 2, mineOf(csv).map((i) => i.slug))
const lower = await api('GET', '/projects?technology=vue%203')
check('技术栈精确匹配（大小写敏感）', lower.json?.items?.length === 0, lower.json?.items?.map((i) => i.slug))

const stars = await api('GET', '/projects?sort=stars')
check(
  'sort=stars 降序',
  mineOf(stars)
    .map((i) => i.slug)
    .join(',') === [slugOf('chart'), slugOf('portfolio'), slugOf('crawler')].join(','),
  mineOf(stars).map((i) => i.slug),
)

const page2 = await api('GET', '/projects?page=2&pageSize=2')
check(
  '分页第二页：page 回显、条数 ≤ pageSize、total 与整表一致',
  page2.json?.page === 2 &&
    (page2.json?.items ?? []).length <= 2 &&
    page2.json?.total === all.json?.total,
  { page: page2.json?.page, total: page2.json?.total, len: page2.json?.items?.length },
)
{
  // 契约 1 拆两类：参数非法 400；语义越界（page > totalPages）200 + 空 items + 真实 total/totalPages
  const beyond = await api('GET', '/projects?page=99')
  check('语义越界返回 200（参数合法，只是没数据）', beyond.status === 200, beyond.status)
  check('语义越界 items 为空', Array.isArray(beyond.json?.items) && beyond.json.items.length === 0, beyond.json?.items?.length)
  check(
    '语义越界仍给真实 total / totalPages',
    beyond.json?.total === all.json?.total && beyond.json?.totalPages === all.json?.totalPages,
    [beyond.json?.total, beyond.json?.totalPages],
  )
  for (const [label, path] of [
    ['page=0', '/projects?page=0'],
    ['page=-1', '/projects?page=-1'],
    ['page=abc', '/projects?page=abc'],
    ['pageSize=0', '/projects?pageSize=0'],
    ['pageSize=101', '/projects?pageSize=101'],
    ['pageSize=999', '/projects?pageSize=999'],
  ]) {
    const bad = await api('GET', path)
    check(`参数非法 ${label} 返回 400`, bad.status === 400, bad.status)
    check(
      `参数非法 ${label} 信封是 VALIDATION_ERROR`,
      bad.json?.error?.code === 'VALIDATION_ERROR',
      bad.json?.error?.code,
    )
  }

  // 错误体结构（契约 §1.2）：details 的键是 field/code/message 三个，一个不多一个不少。
  // code 的值不承诺稳定，但**键必须在**——mock 曾把 code 整个剥掉，结构偏离比词表一致更贵。
  const structure = await api('GET', '/projects?page=0&pageSize=999')
  const detailKeys = Object.keys(structure.json?.error?.details?.[0] ?? {}).sort()
  check(
    'details[] 结构是 field / code / message 三键',
    detailKeys.join(',') === ['code', 'field', 'message'].join(','),
    detailKeys,
  )
  check(
    'details[] 每条都带 field 与 message（可展示）',
    (structure.json?.error?.details ?? []).every(
      (d) => typeof d.field === 'string' && d.field.length > 0 && typeof d.message === 'string' && d.message.length > 0,
    ),
    structure.json?.error?.details,
  )
  check(
    'error 信封的键只有 code / message / details / requestId',
    Object.keys(structure.json?.error ?? {})
      .filter((k) => !['code', 'message', 'details', 'requestId'].includes(k))
      .length === 0,
    Object.keys(structure.json?.error ?? {}),
  )
}
// 表外抽样 0：search 超长按参数错误拒（与前端 clampSearch 上限 200 对齐）
{
  const tooLong = await api('GET', `/projects?search=${'a'.repeat(201)}`)
  check('search 超过 200 字返回 400', tooLong.status === 400, tooLong.status)
  const exact = await api('GET', `/projects?search=${'a'.repeat(200)}`)
  check('search 正好 200 字被接受', exact.status === 200, exact.status)
}

// 表外抽样 1：LIKE 通配符必须按字面量匹配（% 与 _ 都要，后端 fix/v1.2-review 未合）
{
  const pctProject = await createProject(slugOf('pct-literal'), { name: `100%覆盖 ${RUN}` })
  await setStatus(pctProject.id, 'published')
  const pct = await api('GET', `/projects?search=${encodeURIComponent('%')}`)
  check(
    'search=% 按字面量匹配（只命中名字里有 % 的）',
    pct.json?.items?.length === 1 && pct.json.items[0].slug === slugOf('pct-literal'),
    pct.json?.items?.map((i) => i.slug),
  )

  const underscoreProject = await createProject(slugOf('underscore-literal'), { name: `snake_case_tool ${RUN}` })
  await setStatus(underscoreProject.id, 'published')
  const underscore = await api('GET', `/projects?search=${encodeURIComponent('_')}`)
  check(
    'search=_ 按字面量匹配（不是单字符通配）',
    underscore.json?.items?.length === 1 && underscore.json.items[0].slug === slugOf('underscore-literal'),
    underscore.json?.items?.map((i) => i.slug),
  )

  // 表外抽样 2：stars 同分时回 recent（否则顺序不稳，列表会「跳」）
  const tieOld = await createProject(slugOf('tie-old'), {
    name: `同分较旧 ${RUN}`,
    stars: 500,
    last_updated_at: new Date(Date.now() - 30 * DAY).toISOString(),
  })
  await setStatus(tieOld.id, 'published')
  const tieNew = await createProject(slugOf('tie-new'), {
    name: `同分较新 ${RUN}`,
    stars: 500,
    last_updated_at: new Date(Date.now() - 1 * DAY).toISOString(),
  })
  await setStatus(tieNew.id, 'published')
  const tied = await api('GET', '/projects?sort=stars&pageSize=100')
  const tieOrder = tied.json?.items?.map((i) => i.slug).filter((slug) => slug.startsWith(`${RUN}-tie`))
  check(
    'stars 同分时较新的排前面（回 recent）',
    tieOrder?.[0] === slugOf('tie-new') && tieOrder?.[1] === slugOf('tie-old'),
    tieOrder,
  )

  // 收拾干净，别影响后面的计数断言
  for (const id of [pctProject.id, underscoreProject.id, tieOld.id, tieNew.id]) {
    await api('DELETE', `/admin/projects/${id}`)
  }
}

// ---------------------------------------------------------------- 项目：详情
section('项目详情 / 可见性 / slug 301')

const detail = await api('GET', `/projects/${slugOf('portfolio')}`)
check('详情按 slug 取到', detail.status === 200 && detail.json?.slug === slugOf('portfolio'), detail.status)
check(
  '详情含 metadata/notes/固定列字段',
  ['metadata', 'notes', 'role', 'license', 'start_year', 'team_size', 'description_md'].every((k) => k in detail.json),
  Object.keys(detail.json ?? {}),
)
check('前台详情不含曝光状态', !('publish_status' in (detail.json ?? {})))
check('详情字段是 snake_case（无 roleName 之类）', !Object.keys(detail.json ?? {}).some((k) => /[A-Z]/.test(k)), Object.keys(detail.json ?? {}))

const renamed = await api('PATCH', `/admin/projects/${crawler.id}`, { slug: slugOf('crawler-box') })
check('发布过的项目改名成功', renamed.status === 200 && renamed.json?.slug === slugOf('crawler-box'), renamed.json?.slug)
const redirect = await api('GET', `/projects/${slugOf('crawler')}`)
check('旧 slug 返回 301', redirect.status === 301, redirect.status)
check('301 Location 指向新 slug', (redirect.headers.get('location') ?? '').includes(`/projects/${slugOf('crawler-box')}`), redirect.headers.get('location'))

// 行名不能带 RUN 前缀：两个 runner 的行要能一一对上，否则 diff 会把「同一行不同 id」当成分叉
for (const [role, slug] of [
  ['曾发布后归档', slugOf('blog')],
  ['草稿', slugOf('draft')],
  ['软删除', slugOf('deleted')],
]) {
  const res = await api('GET', `/projects/${slug}`)
  check(`${role}项目详情 404（不泄露存在性）`, res.status === 404, res.status)
}

const techs = await api('GET', '/technologies')
{
  // 不断言「整份列表等于我这几个」：库里可能有别的 RUN 残留，那是合法数据。
  // 契约性质是「只汇总可见项目的技术栈」——所以断言两边：本次可见项目的技术栈在，不可见项目的不在。
  const items = techs.json?.items ?? []
  const visible = ['Python', 'SVG', 'TypeScript', 'Vite', 'Vue 3']
  const invisible = ['Hugo' /* 归档 */, 'Rust' /* 草稿 */, 'Go' /* 已软删 */]
  check('technologies 含本次可见项目的技术栈', visible.every((t) => items.includes(t)), items)
  check(
    'technologies 不含不可见项目（归档/草稿/软删）的技术栈',
    invisible.every((t) => !items.includes(t)),
    items.filter((t) => invisible.includes(t)),
  )
  check(
    'technologies 去重且升序（码点序，与实现一致）',
    JSON.stringify(items) === JSON.stringify([...new Set(items)].sort()),
    items,
  )
}

// ---------------------------------------------------------------- 后台项目列表：键集合
section('后台项目列表 / 键集合 / note_count')

const adminList = await api('GET', '/admin/projects?pageSize=5&includeDeleted=true')
const adminItem = adminList.json?.items?.[0] ?? {}
const adminKeys = Object.keys(adminItem).sort()
/**
 * 契约 §4.1：AdminProjectListItem = ProjectListItem + publish_status / published_at / deleted_at / note_count。
 * 这一行是「字段在契约与真后端有、mock 没有也不会红」的补丁——note_count 差一点就这么漏过去。
 * 两侧（real / mock）都要给出同一组键，差一个键就红。
 */
const CONTRACT_ADMIN_ITEM_KEYS = [
  'cover_image_url',
  'created_at',
  'deleted_at',
  'id',
  'last_updated_at',
  'links',
  'name',
  'note_count',
  'progress',
  'publish_status',
  'published_at',
  'slug',
  'stars',
  'summary',
  'tech_stack',
  'updated_at',
  'version',
]
check(
  '后台列表项键集合 = 契约 4.1（含 note_count，无 cover_source_url）',
  adminKeys.join(',') === CONTRACT_ADMIN_ITEM_KEYS.join(','),
  adminKeys,
)
check(
  'note_count 是非负整数',
  Number.isInteger(adminItem.note_count) && adminItem.note_count >= 0,
  adminItem.note_count,
)
check('cover_source_url 只在详情', !('cover_source_url' in adminItem), Object.keys(adminItem))

// ---------------------------------------------------------------- 笔记
section('笔记（N:1）/ 摘要字段 / 可见性 / 301')

const note1 = await api('POST', '/admin/notes', {
  project_id: portfolio.id,
  slug: slugOf('note-1'),
  title: '联调笔记一',
  body_md: '## 背景\n\n正文一，用来验证摘要。',
  publish_status: 'published',
  tags: ['工程'],
})
await new Promise((resolve) => setTimeout(resolve, 5))
const note2 = await api('POST', '/admin/notes', {
  project_id: portfolio.id,
  slug: slugOf('note-2'),
  title: '联调笔记二',
  body_md: '## 背景\n\n正文二。',
  publish_status: 'published',
})
const noteDraft = await api('POST', '/admin/notes', {
  project_id: portfolio.id,
  slug: slugOf('note-draft'),
  title: '草稿笔记',
  body_md: 'x',
  publish_status: 'draft',
})
check('创建笔记 201', [note1, note2, noteDraft].every((r) => r.status === 201), [note1.status, note2.status, noteDraft.status])

const notes = await api('GET', '/notes?pageSize=100')
check('公开列表不含草稿', !notes.json?.items?.some((i) => i.slug === slugOf('note-draft')), notes.json?.items?.map((i) => i.slug))
check(
  '列表项带 project / tags / published_at',
  notes.json?.items?.every((i) => 'project' in i && Array.isArray(i.tags) && 'published_at' in i),
  notes.json?.items?.[0],
)
check(
  '列表项带 excerpt（契约 v1.2.3：三条路径都带）',
  notes.json?.items?.every((i) => 'excerpt' in i),
  Object.keys(notes.json?.items?.[0] ?? {}),
)
check('列表按 published_at 倒序', notes.json?.items?.[0]?.slug === slugOf('note-2'), notes.json?.items?.map((i) => i.slug))
check('pageSize=100 被接受', notes.json?.pageSize === 100, notes.json?.pageSize)
check(
  'excerpt 去 Markdown 且不超过 121 字',
  notes.json?.items?.every(
    (i) =>
      'excerpt' in i &&
      (i.excerpt === null || (String(i.excerpt).length <= 121 && !String(i.excerpt).includes('##'))),
  ),
  notes.json?.items?.map((i) => i.excerpt),
)

const longBody = `${'长正文内容。'.repeat(60)}`
const longNote = await api('POST', '/admin/notes', {
  project_id: portfolio.id,
  slug: slugOf('note-long'),
  title: '超长正文',
  body_md: longBody,
  publish_status: 'published',
})
check('长正文笔记创建 201', longNote.status === 201, longNote.status)
const longDetail = await api('GET', `/notes/${slugOf('note-long')}`)
check(
  '长正文 excerpt 截到 120 字 + 省略号',
  typeof longDetail.json?.excerpt === 'string' &&
    longDetail.json.excerpt.length === 121 &&
    longDetail.json.excerpt.endsWith('…'),
  longDetail.json?.excerpt?.length,
)

const emptyNote = await api('POST', '/admin/notes', {
  project_id: portfolio.id,
  slug: slugOf('note-empty'),
  title: '空正文',
  body_md: '   ',
  publish_status: 'published',
})
check('空正文笔记创建结果符合契约（201 或 400）', [201, 400].includes(emptyNote.status), emptyNote.status)
if (emptyNote.status === 201) {
  const emptyDetail = await api('GET', `/notes/${slugOf('note-empty')}`)
  check('空正文 excerpt 为 null', emptyDetail.json?.excerpt === null, emptyDetail.json?.excerpt)
}

const noteSearch = await api('GET', `/notes?search=${encodeURIComponent('正文二')}`)
check('按正文搜索', noteSearch.json?.items?.length === 1 && noteSearch.json.items[0].slug === slugOf('note-2'), noteSearch.json?.items?.map((i) => i.slug))

const noteDetail = await api('GET', `/notes/${slugOf('note-1')}`)
check('详情含 body_md 与 project', noteDetail.status === 200 && noteDetail.json?.body_md?.includes('## 背景') && noteDetail.json?.project?.slug === slugOf('portfolio'), noteDetail.status)
check('草稿笔记 404', (await api('GET', `/notes/${slugOf('note-draft')}`)).status === 404)
const noteRename = await api('PATCH', `/admin/notes/${note1.json.id}`, { slug: slugOf('note-one') })
check('笔记改名 200', noteRename.status === 200, noteRename.status)
const noteRedirect = await api('GET', `/notes/${slugOf('note-1')}`)
check(
  '笔记旧 slug 301 + Location',
  noteRedirect.status === 301 && (noteRedirect.headers.get('location') ?? '').includes(`/notes/${slugOf('note-one')}`),
  [noteRedirect.status, noteRedirect.headers.get('location')],
)
check('笔记硬删 204', (await api('DELETE', `/admin/notes/${note2.json.id}`)).status === 204)
check('删除后详情 404', (await api('GET', `/notes/${slugOf('note-2')}`)).status === 404)

// 归档项目下的笔记在公开面不可见
await api('POST', '/admin/notes', {
  project_id: blog.id,
  slug: slugOf('note-archived'),
  title: '归档项目下的笔记',
  body_md: '不应出现',
  publish_status: 'published',
})
const afterArchive = await api('GET', '/notes?pageSize=100')
check('归档项目下的笔记不出现在公开列表', !afterArchive.json?.items?.some((i) => i.slug === slugOf('note-archived')), afterArchive.json?.items?.map((i) => i.slug))
check('归档项目下的笔记详情 404', (await api('GET', `/notes/${slugOf('note-archived')}`)).status === 404)

// ---------------------------------------------------------------- 表外抽样 3：笔记 >100 篇
section('笔记 >100 篇（契约 §3.3：pageSize 上限 100，前端据此提示「仅显示最近 100 篇」）')
{
  let created = 0
  for (let i = 0; i < 101; i += 1) {
    const res = await api('POST', '/admin/notes', {
      project_id: portfolio.id,
      slug: slugOf(`bulk-${i}`),
      title: `批量笔记 ${i}`,
      body_md: '批量正文',
      publish_status: 'published',
    })
    if (res.status === 201) created += 1
  }
  check('真的造出 101 篇', created === 101, created)

  const capped = await api('GET', '/notes?pageSize=100')
  check('pageSize=100 只返回 100 条', capped.json?.items?.length === 100, capped.json?.items?.length)
  check('total 报真实总数（> 100，前端据此提示截断）', capped.json?.total >= 101, capped.json?.total)
  const over = await api('GET', '/notes?pageSize=101')
  check('pageSize 超过 100 被拒（400）', over.status === 400, over.status)
}


  return rows
}
// ---------------------------------------------------------------- CLI
const realTransport = async (method, path, body, headers) => {
  const res = await fetch(CONFIG.base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, headers: res.headers, json }
}

const isMain = process.argv[1] ? process.argv[1].endsWith('run.mjs') : false
// 本表只含 must 行，`--strict` / `--no-strict` 都不改变结果：任何一行不满足即退出 1。
// 参数仍被接受，是为了让旧命令（README、CI 历史记录）不会因为多了个 flag 就报未知参数。
const argv = process.argv.slice(2)
const sourceEq = argv.find((arg) => arg.startsWith('--source='))
const sourceIdx = argv.indexOf('--source')
const SOURCE = sourceEq ? sourceEq.split('=')[1] : sourceIdx >= 0 ? (argv[sourceIdx + 1] ?? 'real') : 'real'

// 没有「已知分叉」这回事：整张表只有 must 行（结构断言 assertNoTodoRows）。
// 曾经有过 MAX_KNOWN_DIVERGENCES 常量与 TODO 标注，两者都被移除——把真不一致标成 TODO 就能绕过门禁。

function printSummary(planRows) {
  const failures = planRows.filter((row) => !row.satisfied)
  section('结果')
  console.log(`  契约项：${planRows.length - failures.length}/${planRows.length} 通过`)
  if (failures.length) failures.forEach((row) => console.log(`    ✗ ${row.name} — ${row.note}`))
  const shapeOk = assertNoTodoRows(planRows)
  // 结构不合法（出现非 must 行）与断言失败一样算失败
  return { failures, code: failures.length || !shapeOk ? 1 : 0 }
}

/** 逐行比对两个 runner：同名行必须存在，且「契约是否满足」结论一致。 */
function diffRows(realRows, mockRows) {
  section('双向比对（real vs mock）')
  const byName = new Map(mockRows.map((row) => [row.name, row]))
  const diverged = []
  // 任何一行两侧结论不同都是「真不一致」，没有豁免通道
  for (const real of realRows) {
    const mock = byName.get(real.name)
    if (!mock) {
      console.log(`  ✗ 只有 real 有这一行：${real.name}`)
      diverged.push(real.name)
      continue
    }
    byName.delete(real.name)
    if (real.satisfied !== mock.satisfied) {
      console.log(`  ✗ 口径不一致：${real.name} — real ${real.satisfied} / mock ${mock.satisfied}`)
      diverged.push(real.name)
    }
  }
  for (const leftover of byName.keys()) {
    console.log(`  ✗ 只有 mock 有这一行：${leftover}`)
    diverged.push(leftover)
  }
  const same = realRows.length - diverged.length
  console.log(`  一致 ${same} 行 / 真不一致 ${diverged.length} 行`)
  const shapeOk = assertNoTodoRows([...realRows, ...mockRows])
  if (!shapeOk) diverged.push('出现非 must 行')
  return diverged
}

async function runMockSide() {
  const { spawnSync } = await import('node:child_process')
  const { readFileSync, rmSync } = await import('node:fs')
  const out = `./.contract-mock-rows-${process.pid}.json`
  const res = spawnSync('npx', ['vitest', 'run', 'src/mocks/contract-bridge.spec.ts', '--reporter=dot'], {
    stdio: 'inherit',
    env: { ...process.env, CONTRACT_ROWS_OUT: out },
  })
  try {
    const parsed = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(out, { force: true })
    return parsed
  } catch {
    console.error(`mock 侧没有产出 rows（vitest 退出码 ${res.status}）`)
    return null
  } finally {
    rmSync(out, { force: true })
  }
}

if (!isMain) {
  // 被 `src/mocks/contract-bridge.spec.ts` import 时只导出 runPlan，不触发 CLI
} else if (SOURCE === 'mock') {
  const mockRows = await runMockSide()
  if (!mockRows) process.exit(2)
  process.exit(printSummary(mockRows).code)
} else {
  // 收尾清场与开头同源：/ 自己建的 RUN- 项目自己收，异常路径也走 finally。
  let exitCode = 0
  try {
    const realRows = await runPlan({ transport: realTransport })
    const realSummary = printSummary(realRows)
    if (SOURCE === 'both') {
      const mockRows = await runMockSide()
      if (!mockRows) {
        exitCode = 2
      } else {
        const diverged = diffRows(realRows, mockRows)
        exitCode = realSummary.code || diverged.length ? 1 : 0
      }
    } else if (SOURCE === 'real') {
      exitCode = realSummary.code
    } else {
      console.error(`未知 --source=${SOURCE}（可选 real / mock / both）`)
      exitCode = 2
    }
  } finally {
    try {
      await cleanupRunProjects()
    } catch (err) {
      console.error(`  ⚠ 收尾清场失败：${err instanceof Error ? err.message : String(err)}`)
      if (exitCode === 0) exitCode = 1
    }
  }
  process.exit(exitCode)
}
