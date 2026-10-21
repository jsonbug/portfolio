/**
 * 契约联调套件：拿**真实后端**逐条校验前端依赖的契约点。
 *
 * 为什么要有它：`frontend/src/mocks/handlers.ts` 是手写的契约副本，前后端任一侧漂移，
 * 只有打真后端才能发现。这套断言以前是临时脚本，跑完就删、下次只能人肉复现，所以固化进仓库。
 *
 * 用法（后端需先在本地起着）：
 *   cd backend && npx prisma migrate deploy && npx prisma generate
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=$(...) PORT=4310 npx tsx src/index.ts
 *   cd frontend && npm run contract            # 常规跑
 *   npm run contract -- --strict               # 已知后端缺口也当失败（后端修完后用）
 *
 * 环境变量：CONTRACT_BASE_URL（默认 http://127.0.0.1:4310/api/v1）
 *           CONTRACT_ADMIN_USERNAME / CONTRACT_ADMIN_PASSWORD（默认 admin / integration-pass）
 *
 * ⚠️ 脚本会软删目标库里所有既有项目，保证断言里的计数是确定的；只对本地 dev.db 用。
 */
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:4310/api/v1'
const USERNAME = process.env.CONTRACT_ADMIN_USERNAME ?? 'admin'
const PASSWORD = process.env.CONTRACT_ADMIN_PASSWORD ?? 'integration-pass'
const STRICT = process.argv.includes('--strict')

/** 每次运行一组独立 slug：项目软删后 slug 仍被占用，重复跑不能撞 409。 */
const RUN = `c${Date.now().toString(36)}`
const slugOf = (name) => `${RUN}-${name}`

const DAY = 86_400_000
let token = ''

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

const failures = []
/** 带 TODO(backend:…) 标注、后端尚未合的行（不阻断退出码，但必须一眼可见）。 */
const pending = []
/** 后端已修、标注该删的行。 */
const todoDone = []

/** 契约必须满足；失败即退出码 1。 */
function check(name, cond, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(extra)?.slice(0, 300)}`}`)
  if (!cond) failures.push(name)
}

/**
 * 契约已定、后端还没合的行：**显式标注**，断言「当前真实行为」，不静默放行、也不从表里删。
 *
 * 约定（审查官一眼分清责任）：
 *   ✓            后端已符合契约 → 把该行改成 check() 并删掉标注
 *   ✗ + TODO(…)  红行 = 后端还没合（不阻断退出码）
 *   ✗✗           现状既不是旧行为也不符合契约 → 立刻查
 */
function pendingBackend(name, currentHolds, contractHolds, todo, extra) {
  if (contractHolds) {
    console.log(`  ✓ ${name}（后端已修，删掉本行 TODO 标注即可）`)
    todoDone.push(name)
    return
  }
  if (currentHolds) {
    console.log(`  ✗ ${name} — TODO(${todo}) 现状：${JSON.stringify(extra)?.slice(0, 200)}`)
    pending.push(`${name} [${todo}]`)
    return
  }
  console.log(`  ✗✗ ${name} — 现状既不是旧行为也不符合契约：${JSON.stringify(extra)?.slice(0, 200)}`)
  failures.push(name)
}

function section(title) {
  console.log(`\n${title}`)
}

const login = await api('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
if (login.status !== 200 || typeof login.json?.token !== 'string') {
  console.error(`登录失败（${login.status}）——后端是否已启动在 ${BASE}？`)
  process.exit(2)
}
token = login.json.token

/** 清场：软删所有既有项目（公开面归零，计数才能断言）。 */
async function resetProjects() {
  const existing = await api('GET', '/admin/projects?pageSize=100&includeDeleted=true')
  for (const item of existing.json?.items ?? []) {
    if (!item.deleted_at) await api('DELETE', `/admin/projects/${item.id}`)
  }
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

await resetProjects()

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
check('列表只含 3 个可见项目', all.json?.total === 3, all.json?.total)
check(
  'counts = {all 3, ongoing 2, launched 1}',
  JSON.stringify(all.json?.counts) === JSON.stringify({ all: 3, ongoing: 2, launched: 1 }),
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
  all.json?.items?.map((i) => i.slug).join(',') === [slugOf('portfolio'), slugOf('crawler'), slugOf('chart')].join(','),
  all.json?.items?.map((i) => i.slug),
)

const launched = await api('GET', '/projects?progress=launched')
check('progress=launched 只留已上线', launched.json?.items?.length === 1 && launched.json.items[0].slug === slugOf('chart'))
check('分段过滤后 counts 不变', JSON.stringify(launched.json?.counts) === JSON.stringify(all.json?.counts), launched.json?.counts)

const byName = await api('GET', `/projects?search=${encodeURIComponent('抓取')}`)
check('search 命中名称', byName.json?.items?.map((i) => i.slug).join(',') === slugOf('crawler'), byName.json?.items?.map((i) => i.slug))
const bySummary = await api('GET', `/projects?search=${encodeURIComponent('图表')}`)
check('search 命中摘要', bySummary.json?.items?.map((i) => i.slug).join(',') === slugOf('chart'), bySummary.json?.items?.map((i) => i.slug))
check('搜索会重算 counts', bySummary.json?.counts?.all === 1, bySummary.json?.counts)

const py = await api('GET', '/projects?technology=Python')
check('technology=Python 命中 1 个', py.json?.items?.length === 1 && py.json.items[0].slug === slugOf('crawler'), py.json?.items?.map((i) => i.slug))
const repeat = await api('GET', '/projects?technology=Vue%203&technology=SVG')
check('technology 重复参数 = 任一命中', repeat.json?.items?.length === 2, repeat.json?.items?.map((i) => i.slug))
const csv = await api('GET', '/projects?technology=Vue%203,SVG')
check('technology 逗号分隔等价值重复参数', csv.json?.items?.length === 2, csv.json?.items?.map((i) => i.slug))
const lower = await api('GET', '/projects?technology=vue%203')
check('技术栈精确匹配（大小写敏感）', lower.json?.items?.length === 0, lower.json?.items?.map((i) => i.slug))

const stars = await api('GET', '/projects?sort=stars')
check(
  'sort=stars 降序',
  stars.json?.items?.map((i) => i.slug).join(',') === [slugOf('chart'), slugOf('portfolio'), slugOf('crawler')].join(','),
  stars.json?.items?.map((i) => i.slug),
)

const page2 = await api('GET', '/projects?page=2&pageSize=2')
check('分页第二页', page2.json?.items?.length === 1 && page2.json.page === 2, page2.json?.items?.map((i) => i.slug))
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
  const badParam = await api('GET', '/projects?page=0')
  check('参数非法返回 400', badParam.status === 400, badParam.status)
  check('参数非法信封是 VALIDATION_ERROR', badParam.json?.error?.code === 'VALIDATION_ERROR', badParam.json?.error?.code)
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
  pendingBackend(
    'search=% 按字面量匹配（只命中名字里有 % 的）',
    // 现状（未转义）：% 当通配符，等于「匹配全部」
    pct.json?.items?.length === pct.json?.total,
    pct.json?.items?.length === 1 && pct.json.items[0].slug === slugOf('pct-literal'),
    'backend:fix/v1.2-review',
    pct.json?.items?.map((i) => i.slug),
  )

  const underscoreProject = await createProject(slugOf('underscore-literal'), { name: `snake_case_tool ${RUN}` })
  await setStatus(underscoreProject.id, 'published')
  const underscore = await api('GET', `/projects?search=${encodeURIComponent('_')}`)
  pendingBackend(
    'search=_ 按字面量匹配（不是单字符通配）',
    // 现状（未转义）：_ 当单字符通配，命中几乎所有名字（≥ 项目总数）
    (underscore.json?.items?.length ?? 0) >= (pct.json?.total ?? 0),
    underscore.json?.items?.length === 1 && underscore.json.items[0].slug === slugOf('underscore-literal'),
    'backend:fix/v1.2-review',
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

for (const slug of [slugOf('blog'), slugOf('draft'), slugOf('deleted')]) {
  const res = await api('GET', `/projects/${slug}`)
  check(`${slug} 详情 404`, res.status === 404, res.status)
}

const techs = await api('GET', '/technologies')
check(
  'technologies 只含可见项目技术栈',
  JSON.stringify(techs.json?.items) === JSON.stringify(['Python', 'SVG', 'TypeScript', 'Vite', 'Vue 3']),
  techs.json?.items,
)

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
pendingBackend(
  '列表项带 excerpt（契约 v1.2.3）',
  notes.json?.items?.every((i) => !('excerpt' in i)),
  notes.json?.items?.every((i) => 'excerpt' in i),
  'backend:excerpt',
  Object.keys(notes.json?.items?.[0] ?? {}),
)
check('列表按 published_at 倒序', notes.json?.items?.[0]?.slug === slugOf('note-2'), notes.json?.items?.map((i) => i.slug))
check('pageSize=100 被接受', notes.json?.pageSize === 100, notes.json?.pageSize)
pendingBackend(
  'excerpt 去 Markdown 且不超过 121 字',
  notes.json?.items?.every((i) => !('excerpt' in i)),
  notes.json?.items?.every(
    (i) =>
      'excerpt' in i &&
      (i.excerpt === null || (String(i.excerpt).length <= 121 && !String(i.excerpt).includes('##'))),
  ),
  'backend:excerpt',
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
pendingBackend(
  '长正文 excerpt 截到 120 字 + 省略号',
  longDetail.json?.excerpt === undefined,
  typeof longDetail.json?.excerpt === 'string' && longDetail.json.excerpt.length === 121 && longDetail.json.excerpt.endsWith('…'),
  'backend:excerpt',
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
  pendingBackend(
    '空正文 excerpt 为 null',
    emptyDetail.json?.excerpt === undefined,
    emptyDetail.json?.excerpt === null,
    'backend:excerpt',
    emptyDetail.json?.excerpt,
  )
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

// ---------------------------------------------------------------- 收尾
section('结果')
console.log(`  契约必须项：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`)
if (pending.length) {
  console.log(`  带 TODO 标注、等后端合的行：${pending.length} 项（红行 = 后端还没合，不是前端没改对）`)
  for (const item of pending) console.log(`    ✗ ${item}`)
}
if (todoDone.length) {
  console.log(`  后端已修、标注可以删的行：${todoDone.length} 项`)
  for (const item of todoDone) console.log(`    ✓ ${item}`)
}
if (failures.length) failures.forEach((name) => console.log(`    ✗ ${name}`))
process.exit(failures.length || (STRICT && pending.length) ? 1 : 0)
