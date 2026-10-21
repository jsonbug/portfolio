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
const gaps = []

/** 契约必须满足；失败即退出码 1。 */
function check(name, cond, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(extra)?.slice(0, 300)}`}`)
  if (!cond) failures.push(name)
}

/** 已知后端缺口：默认只告警（--strict 时算失败）。 */
function knownGap(name, cond, extra) {
  console.log(`  ${cond ? '✓' : '⚠'} ${name}${cond ? '' : ` — 已知缺口：${JSON.stringify(extra)?.slice(0, 200)}`}`)
  if (!cond) gaps.push(name)
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
knownGap(
  '分页越界返回 400（契约：page > totalPages 一律 400）',
  (
    await api('GET', '/projects?page=99')
  ).status === 400,
  (await api('GET', '/projects?page=99')).status,
)
knownGap(
  'search 里的 % 按字面量匹配（未转义）',
  (
    await api('GET', '/projects?search=%25')
  ).json?.items?.length === 0,
  (await api('GET', '/projects?search=%25')).json?.items?.length,
)

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
knownGap(
  '列表项带 excerpt（契约 v1.2.3，后端实现中）',
  notes.json?.items?.every((i) => 'excerpt' in i),
  Object.keys(notes.json?.items?.[0] ?? {}),
)
check('列表按 published_at 倒序', notes.json?.items?.[0]?.slug === slugOf('note-2'), notes.json?.items?.map((i) => i.slug))
check('pageSize=100 被接受', notes.json?.pageSize === 100, notes.json?.pageSize)
knownGap(
  'excerpt 去 Markdown 且不超过 121 字',
  notes.json?.items?.every(
    (i) => !('excerpt' in i) || i.excerpt === null || (i.excerpt.length <= 121 && !i.excerpt.includes('##')),
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
knownGap(
  '长正文 excerpt 截到 120 字 + 省略号',
  typeof longDetail.json?.excerpt === 'string' && longDetail.json.excerpt.length === 121 && longDetail.json.excerpt.endsWith('…'),
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
  knownGap('空正文 excerpt 为 null', emptyDetail.json?.excerpt === null, emptyDetail.json?.excerpt)
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

// ---------------------------------------------------------------- 收尾
section('结果')
console.log(`  契约必须项：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`)
if (gaps.length) {
  console.log(`  已知后端缺口：${gaps.length} 项（后端 fix/v1.2-review 修复后应转绿；--strict 时计为失败）`)
  for (const gap of gaps) console.log(`    ⚠ ${gap}`)
}
if (failures.length) failures.forEach((name) => console.log(`    ✗ ${name}`))
process.exit(failures.length || (STRICT && gaps.length) ? 1 : 0)
