#!/usr/bin/env node
/**
 * compose 部署冒烟：对一套已经起来的 docker compose 环境跑完整业务链路。
 *
 *   LINK_CHECK_ENABLED=0 docker compose up -d --build   # 见下方「外网请求」
 *   docker compose exec -T web true                    # 等 healthy
 *   ADMIN_PASSWORD='你的管理员口令' node scripts/smoke-compose.mjs
 *
 * 可选参数（也可用环境变量）：
 *   --base   http://localhost:8080   前端入口（经 nginx 反代 /api/v1）
 *   --user   admin                   ADMIN_USERNAME
 *   --pass   -                       ADMIN_PASSWORD（缺省会直接报错退出）
 *   --slug   自定项目 slug（同库重复跑会冲突，默认带时间戳）
 *   --public 额外用 https://github.com/jsonbug/portfolio 做一次真实外网链接重检
 *            （默认不跑：离线/内网环境不该因为出网失败而红）
 *   --keep-data 跑完不软删自己建的项目（默认会软删，避免在被复用的库上累积脏数据）
 *
 * 关于「脏数据」：默认那句「软删」是**置 deleted_at**，行还在——每跑一次，库里的项目/笔记/链接/
 * 元数据/截图各 +N 行，只是不再出现在任何列表里。所以反复跑不会把功能跑坏，但会持续堆行；
 * 介意的话就用一次性库（`docker compose down -v` 后重建）。不做硬删：脚本手里是管理员 token，
 * 一次误配就是不可逆的数据删除。
 *
 * 外网请求：脚本**自己**不发任何外网请求。但后端的建链接自动检查默认开启
 * （lib/link-check.ts:251，NODE_ENV=test 或 LINK_CHECK_ENABLED=0 时关闭），所以
 * **起服务时**要显式 `LINK_CHECK_ENABLED=0`，否则建链接那一刻后端会真的去连一次外网，
 * 在受限网络里把该链接记成 failed（不影响本脚本判定，但库里会留脏状态）。
 * 本脚本假定栈是以 LINK_CHECK_ENABLED=0 起的，`新建链接默认 unknown` 这条依赖这个前提。
 *
 * ## 断言写法两条通则（这两类坑会反复长出来，改动本文件前先读）
 *
 * 1. **SKIP 不是 PASS**：条件不满足而没执行的分支只打印 `SKIP`，既不算通过也不算失败。
 *    把「跳过」印成 PASS 会让「永远 N 行绿」比「这次真跑了 M 行」更常见——假的绿会掩盖
 *    后面所有批次的回归，比少一条断言更贵。收尾必须分开报「通过/失败/跳过」三项。
 * 2. **空集合上的断言不算断言**：`.every()` / `.some()` / `!(items ?? []).some(...)` 在空
 *    数组上恒真/恒假，会让「列表接口返回空页」这种最严重的回归全绿。凡是要断言「集合里
 *    没有 X」或「集合里每个都满足 P」，必须先有一条**非空前置断言**
 *    （如 `check('列表非空', items.length > 0)`），再断否定/全称命题。
 *    同理：不要断言「请求体里没发的东西」（`create 响应不含 links` 这类自证），
 *    要断言「响应里应当出现的内容」。
 *
 * 覆盖：nginx 静态托管与 history fallback → /api/v1 同源反代 → 登录 → 草稿不可见
 * → 发布后前台可见（列表/详情/笔记/摘要）→ 技术栈与进展过滤、排序 → 后台分段计数
 * → 元数据 KV 与截图 → 软删/恢复 → B16 链接重检（私网必须 failed）→ 契约错误信封。
 *
 * 只用标准库，退出码非 0 表示失败，逐条打印 PASS/FAIL/SKIP。
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = (arg('base', process.env.SMOKE_BASE ?? 'http://localhost:8080')).replace(/\/+$/, '');
const API = `${BASE}/api/v1`;
const USER = arg('user', process.env.ADMIN_USERNAME ?? 'admin');
const PASS = arg('pass', process.env.ADMIN_PASSWORD ?? '');
const SLUG = arg('slug', `smoke-${Date.now().toString(36)}`);
const CHECK_PUBLIC = flag('public');
const KEEP_DATA = flag('keep-data');

let failed = 0;
let passed = 0;
let skipped = 0;
const ok = (name, extra = '') => {
  passed += 1;
  console.log(`PASS  ${name}${extra ? ` — ${extra}` : ''}`);
};
const bad = (name, detail) => {
  failed += 1;
  console.log(`FAIL  ${name} — ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name, detail) : bad(name, detail));
// 未执行的分支走这里：不计 PASS、不计 FAIL（见文件头通则 1）
const skip = (name, why) => {
  skipped += 1;
  console.log(`SKIP  ${name} — ${why}`);
};

if (!PASS) {
  console.error('缺少管理员口令：用 --pass <口令> 或环境变量 ADMIN_PASSWORD 传入（对应 .env 里 ADMIN_PASSWORD_HASH 的明文）。');
  process.exit(2);
}

async function req(method, path, { token, body, expect } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expect !== undefined) {
    check(`${method} ${path} → ${expect}`, res.status === expect, `实际 ${res.status}${res.status === expect ? '' : ` ${text.slice(0, 200)}`}`);
  }
  return { status: res.status, data };
}

const raw = async (path, expect) => {
  const res = await fetch(`${BASE}${path}`);
  check(`GET ${path} → ${expect}`, res.status === expect, `实际 ${res.status}`);
  return res;
};

const items = (res) => (Array.isArray(res?.data?.items) ? res.data.items : null);
const slugsOf = (list) => (list ?? []).map((p) => p.slug);

console.log(`目标 ${BASE}（API ${API}）\n`);

// ---- 1. nginx：静态托管 + SPA history fallback ----
const index = await raw('/', 200);
check('首页是前端产物（text/html）', (index.headers.get('content-type') ?? '').includes('text/html'), index.headers.get('content-type') ?? '');
await raw('/projects', 200);
await raw('/admin/projects', 200);
await raw('/healthz', 200);

// ---- 2. 同源反代：/api/v1 打到 api 容器 ----
const health = await req('GET', '/health', { expect: 200 });
check('健康检查返回 ok', health.data?.status === 'ok', JSON.stringify(health.data));

// ---- 3. 认证 ----
await req('GET', '/admin/projects', { expect: 401 });
await req('POST', '/auth/login', { body: { username: USER, password: `${PASS}-wrong` }, expect: 401 });
const login = await req('POST', '/auth/login', { body: { username: USER, password: PASS }, expect: 200 });
const token = login.data?.token;
if (!token) {
  bad('登录拿到 token', JSON.stringify(login.data).slice(0, 200));
  console.log('\n登录失败，后续用例跳过。');
  process.exit(1);
}
check('登录拿到 token', typeof token === 'string' && token.split('.').length === 3, `expiresAt=${login.data?.expiresAt ?? '?'}`);

// ---- 4. 新建草稿项目 A（launched / Fastify+Vue 3）+ 两条链接 + 一篇笔记草稿 ----
const created = await req('POST', '/admin/projects', {
  token,
  expect: 201,
  body: {
    name: '部署冒烟项目',
    slug: SLUG,
    summary: 'compose 全链路冒烟',
    description_md: '# 用 compose 起的一套\n\n- 前端 nginx\n- 后端 Fastify',
    progress: 'launched',
    tech_stack: ['Fastify', 'Vue 3'],
    team_size: 1,
    start_year: 2026,
  },
});
const project = created.data ?? {};
const projectId = project.id;
check('新项目默认 draft', project.publish_status === 'draft', `publish_status=${project.publish_status}`);
check(
  '建项目回显内容与请求一致（tech_stack / progress）',
  JSON.stringify(project.tech_stack) === JSON.stringify(['Fastify', 'Vue 3']) && project.progress === 'launched',
  `tech_stack=${JSON.stringify(project.tech_stack)} progress=${project.progress}`,
);
check(
  '建项目不会顺手建链接（links 为空数组）',
  Array.isArray(project.links) && project.links.length === 0,
  `links=${JSON.stringify(project.links)}`,
);

// 链接逐条添加：POST /admin/projects/:id/links
const repo = await req('POST', `/admin/projects/${projectId}/links`, {
  token,
  expect: 201,
  body: { type: 'repo', label: 'GitHub', url: 'https://github.com/jsonbug/portfolio' },
});
const priv = await req('POST', `/admin/projects/${projectId}/links`, {
  token,
  expect: 201,
  body: { type: 'site', label: '私网自检', url: 'http://127.0.0.1:3000/api/v1/health' },
});
const repoLink = repo.data ?? {};
const privLink = priv.data ?? {};
check(
  '链接返回 snake_case 字段',
  'last_status' in repoLink && 'last_http_status' in repoLink && 'last_checked_at' in repoLink,
  Object.keys(repoLink).join(','),
);
// 前提是栈以 LINK_CHECK_ENABLED=0 起（见文件头）：自动检查关闭时这条是确定性的
check(
  '新建链接默认 unknown（自动检查异步、本脚本要求关掉）',
  repoLink.last_status === 'unknown',
  `last_status=${repoLink.last_status}（若你的栈开着自动检查，这条会随网络结果漂移：起服务时设 LINK_CHECK_ENABLED=0）`,
);

const note = await req('POST', '/admin/notes', {
  token,
  expect: 201,
  body: {
    project_id: projectId,
    slug: `${SLUG}-note`,
    title: '部署笔记',
    body_md: '# 笔记正文\n\n正文里应当出现**这段文字**，摘要要截出来。',
    publish_status: 'draft',
  },
});
const noteId = note.data?.id;

// 第三个项目：保持 draft 到最后一节（既让后台 draft 分段非空，也是非法跃迁用例的载体）
const trans = await req('POST', '/admin/projects', {
  token,
  expect: 201,
  body: { name: '跃迁校验', slug: `${SLUG}-trans` },
});
const transId = trans.data?.id;

// 排序用的展示字段是人工填写项（last_updated_at 可空，为空时服务端回退系统 updated_at）；
// 显式写入两个不同时间，sort=recent 的断言才能确定性成立。
await req('PATCH', `/admin/projects/${projectId}`, { token, expect: 200, body: { last_updated_at: '2026-01-01T00:00:00.000Z' } });

// ---- 5. 草稿不可见（先造一个已发布项目 B，保证列表非空，再断否定命题） ----
await req('GET', `/projects/${SLUG}`, { expect: 404 });
await req('GET', `/notes/${SLUG}-note`, { expect: 404 });

// 项目 B：不同技术栈 + 不同进展阶段，既让前台列表非空，也用于过滤断言
const otherSlug = `${SLUG}-b`;
const other = await req('POST', '/admin/projects', {
  token,
  expect: 201,
  body: { name: '部署冒烟对照项目', slug: otherSlug, progress: 'ongoing', tech_stack: ['Node.js'], last_updated_at: '2026-06-01T00:00:00.000Z' },
});
const otherId = other.data?.id;
await req('PATCH', `/admin/projects/${otherId}`, { token, expect: 200, body: { publish_status: 'published' } });

const listWithB = await req('GET', '/projects', { expect: 200 });
const listWithBItems = items(listWithB);
check('前台列表非空（否定/全称断言的前置）', (listWithBItems ?? []).length > 0, `total=${listWithB.data?.total}`);
check('已发布项目出现在前台列表（正向）', slugsOf(listWithBItems).includes(otherSlug), `slugs=${JSON.stringify(slugsOf(listWithBItems))}`);
check('草稿项目不出现在前台列表', !slugsOf(listWithBItems).includes(SLUG), `slugs=${JSON.stringify(slugsOf(listWithBItems))}`);

// ---- 6. 发布（项目 A + 笔记）→ 前台可见 ----
const published = await req('PATCH', `/admin/projects/${projectId}`, { token, expect: 200, body: { publish_status: 'published' } });
check(
  '项目发布后 published_at 有值',
  published.data?.publish_status === 'published' && Boolean(published.data?.published_at),
  `published_at=${published.data?.published_at}`,
);
await req('PATCH', `/admin/notes/${noteId}`, { token, expect: 200, body: { publish_status: 'published' } });

const afterList = await req('GET', '/projects', { expect: 200 });
check('发布后出现在前台列表', slugsOf(items(afterList)).includes(SLUG), `slugs=${JSON.stringify(slugsOf(items(afterList)))}`);

const detail = await req('GET', `/projects/${SLUG}`, { expect: 200 });
check('详情按 slug 命中', detail.data?.slug === SLUG, `slug=${detail.data?.slug}`);
check('详情带 Markdown 原文', typeof detail.data?.description_md === 'string' && detail.data.description_md.includes('前端 nginx'), `description_md=${String(detail.data?.description_md).slice(0, 40)}`);
const detailLinks = Array.isArray(detail.data?.links) ? detail.data.links : [];
check('详情带两条链接', detailLinks.length === 2, `links=${detailLinks.length}`);
check(
  '链接内容正确（type / url 不是只数条数）',
  detailLinks.some((l) => l.type === 'repo' && l.url === 'https://github.com/jsonbug/portfolio') &&
    detailLinks.some((l) => l.type === 'site' && l.url === 'http://127.0.0.1:3000/api/v1/health'),
  JSON.stringify(detailLinks.map((l) => `${l.type}:${l.url}`)),
);
check('详情笔记含已发布那条', (detail.data?.notes ?? []).some((n) => n.slug === `${SLUG}-note`), JSON.stringify((detail.data?.notes ?? []).map((n) => n.slug)));

// ---- 7. 公开笔记列表：正向断言（先断「已发布笔记出现」，再断「草稿不出现」） ----
const notesList = await req('GET', '/notes', { expect: 200 });
const notesItems = items(notesList);
check('公开笔记列表非空（前置）', (notesItems ?? []).length > 0, `total=${notesList.data?.total}`);
check('已发布笔记出现在 /notes（正向，之前完全没有这条）', (notesItems ?? []).some((n) => n.slug === `${SLUG}-note`), `slugs=${JSON.stringify((notesItems ?? []).map((n) => n.slug))}`);
const listedNote = (notesItems ?? []).find((n) => n.slug === `${SLUG}-note`);
check(
  '笔记摘要 excerpt 有内容（去 Markdown 后的正文片段）',
  typeof listedNote?.excerpt === 'string' && listedNote.excerpt.includes('这段文字'),
  `excerpt=${JSON.stringify(listedNote?.excerpt)}`,
);
await req('GET', '/notes?pageSize=100', { expect: 200 });
const noteDetail = await req('GET', `/notes/${SLUG}-note`, { expect: 200 });
check(
  '笔记详情按 slug 命中并带正文',
  noteDetail.data?.slug === `${SLUG}-note` && noteDetail.data?.title === '部署笔记' && typeof noteDetail.data?.body_md === 'string' && noteDetail.data.body_md.length > 0,
  `slug=${noteDetail.data?.slug} title=${noteDetail.data?.title}`,
);

// 草稿笔记不出现（前置：列表非空）
const draftNote = await req('POST', '/admin/notes', {
  token,
  expect: 201,
  body: { project_id: projectId, slug: `${SLUG}-note-draft`, title: '草稿笔记', body_md: '草稿正文', publish_status: 'draft' },
});
const draftNoteId = draftNote.data?.id;
const notesAfterDraft = await req('GET', '/notes', { expect: 200 });
check('草稿笔记不出现在前台 /notes', items(notesAfterDraft).length > 0 && !(items(notesAfterDraft) ?? []).some((n) => n.slug === `${SLUG}-note-draft`), `slugs=${JSON.stringify((items(notesAfterDraft) ?? []).map((n) => n.slug))}`);
await req('GET', `/notes/${SLUG}-note-draft`, { expect: 404 });

// ---- 8. 过滤 / 排序：断言「真的生效」，不是只断言 200 ----
const vueFiltered = await req('GET', '/projects?technology=Vue%203', { expect: 200 });
const vueItems = items(vueFiltered) ?? [];
check('technology=Vue 3 命中本项目', slugsOf(vueItems).includes(SLUG), `slugs=${JSON.stringify(slugsOf(vueItems))} total=${vueFiltered.data?.total}`);
check('technology=Vue 3 排除 Node.js 项目', !slugsOf(vueItems).includes(otherSlug), `slugs=${JSON.stringify(slugsOf(vueItems))}`);
check('technology 过滤后每条都真有该技术栈', vueItems.length > 0 && vueItems.every((p) => (p.tech_stack ?? []).includes('Vue 3')), JSON.stringify(vueItems.map((p) => p.tech_stack)));

const nodeFiltered = await req('GET', '/projects?technology=Node.js', { expect: 200 });
const nodeItems = items(nodeFiltered) ?? [];
check('technology=Node.js 命中对照项目', slugsOf(nodeItems).includes(otherSlug), `slugs=${JSON.stringify(slugsOf(nodeItems))}`);
check('technology=Node.js 排除 Vue 3 项目', !slugsOf(nodeItems).includes(SLUG), `slugs=${JSON.stringify(slugsOf(nodeItems))}`);

const ongoing = await req('GET', '/projects?progress=ongoing', { expect: 200 });
const ongoingItems = items(ongoing) ?? [];
check('progress=ongoing 命中对照项目', slugsOf(ongoingItems).includes(otherSlug), `slugs=${JSON.stringify(slugsOf(ongoingItems))}`);
check('progress=ongoing 排除 launched 项目', !slugsOf(ongoingItems).includes(SLUG), `slugs=${JSON.stringify(slugsOf(ongoingItems))}`);
check('progress=ongoing 每条都是 ongoing', ongoingItems.length > 0 && ongoingItems.every((p) => p.progress === 'ongoing'), JSON.stringify(ongoingItems.map((p) => p.progress)));

const launched = await req('GET', '/projects?progress=launched', { expect: 200 });
const launchedItems = items(launched) ?? [];
check('progress=launched 命中本项目', slugsOf(launchedItems).includes(SLUG), `slugs=${JSON.stringify(slugsOf(launchedItems))}`);
check('progress=launched 排除 ongoing 项目', !slugsOf(launchedItems).includes(otherSlug), `slugs=${JSON.stringify(slugsOf(launchedItems))}`);

const sorted = await req('GET', '/projects?sort=recent&page=1&pageSize=50', { expect: 200 });
const sortedItems = items(sorted) ?? [];
const stamps = sortedItems.map((p) => (p.last_updated_at ? Date.parse(p.last_updated_at) : NaN));
check(
  'sort=recent 按 last_updated_at 降序（排序真的生效）',
  sortedItems.length > 1 &&
    stamps.every((t) => Number.isFinite(t)) &&
    stamps.every((t, i) => i === 0 || stamps[i - 1] >= t) &&
    sortedItems[0]?.slug === otherSlug,
  `顺序=${JSON.stringify(sortedItems.map((p) => `${p.slug}@${p.last_updated_at}`))}`,
);
// 过滤与分页自洽：过滤后的 total 必须等于分页前的集合大小
check(
  '过滤后的 total 与 items 长度自洽（未分页时）',
  vueFiltered.data?.total === vueItems.length,
  `total=${vueFiltered.data?.total} items=${vueItems.length}`,
);

// ---- 9. 后台：分段计数 / 详情 / 过滤（均有非空前置） ----
const adminList = await req('GET', '/admin/projects', { token, expect: 200 });
const counts = adminList.data?.counts ?? {};
check('后台返回四段计数', ['all', 'draft', 'published', 'archived'].every((k) => typeof counts[k] === 'number'), JSON.stringify(counts));
check('counts.all = draft + published + archived', typeof counts.all === 'number' && counts.all === counts.draft + counts.published + counts.archived, JSON.stringify(counts));
const adminDetail = await req('GET', `/admin/projects/${projectId}`, { token, expect: 200 });
const adminNotes = Array.isArray(adminDetail.data?.notes) ? adminDetail.data.notes : [];
check('后台详情带笔记（非空前置）', adminNotes.length > 0, `notes=${adminNotes.length}`);
check('后台详情笔记带 publish_status', adminNotes.every((n) => typeof n.publish_status === 'string'), JSON.stringify(adminNotes.map((n) => `${n.slug}:${n.publish_status}`)));
check(
  '后台详情里已发布/草稿两种状态都正确',
  adminNotes.some((n) => n.slug === `${SLUG}-note` && n.publish_status === 'published') &&
    adminNotes.some((n) => n.slug === `${SLUG}-note-draft` && n.publish_status === 'draft'),
  JSON.stringify(adminNotes.map((n) => `${n.slug}:${n.publish_status}`)),
);

const draftOnly = await req('GET', '/admin/projects?publish_status=draft', { token, expect: 200 });
const draftOnlyItems = items(draftOnly) ?? [];
const draftCounts = draftOnly.data?.counts ?? {};
check('分段过滤不改 counts（仍是全部口径，两侧都必须有值）', typeof counts.all === 'number' && typeof draftCounts.all === 'number' && JSON.stringify(draftCounts) === JSON.stringify(counts), `全部=${JSON.stringify(counts)} 过滤后=${JSON.stringify(draftCounts)}`);
check('publish_status=draft 非空（前置）', draftOnlyItems.length > 0 && counts.draft > 0, `items=${draftOnlyItems.length} counts.draft=${counts.draft}`);
check('publish_status=draft 只返回草稿', draftOnlyItems.length > 0 && draftOnlyItems.every((p) => p.publish_status === 'draft'), JSON.stringify(draftOnlyItems.map((p) => p.publish_status)));
check('publish_status=draft 含那个仍为草稿的项目', slugsOf(draftOnlyItems).includes(`${SLUG}-trans`), `slugs=${JSON.stringify(slugsOf(draftOnlyItems))}`);

const adminNotesAll = await req('GET', '/admin/notes', { token, expect: 200 });
const adminNotesItems = items(adminNotesAll) ?? [];
check('后台笔记列表非空（前置）', adminNotesItems.length > 0, `total=${adminNotesAll.data?.total}`);
check('后台笔记列表含草稿笔记', adminNotesItems.some((n) => n.slug === `${SLUG}-note-draft`), `slugs=${JSON.stringify(adminNotesItems.map((n) => n.slug))}`);
const adminNotesPublished = await req('GET', '/admin/notes?publish_status=published', { token, expect: 200 });
const adminPublishedItems = items(adminNotesPublished) ?? [];
check('后台笔记列表非空（前置，published 段）', adminPublishedItems.length > 0, `total=${adminNotesPublished.data?.total}`);
check('后台 publish_status=published 排除草稿', !adminPublishedItems.some((n) => n.slug === `${SLUG}-note-draft`), `slugs=${JSON.stringify(adminPublishedItems.map((n) => n.slug))}`);

// ---- 10. 元数据 KV（整体替换，body 是裸数组）+ 截图 ----
const meta = await req('PUT', `/admin/projects/${projectId}/metadata`, {
  token,
  expect: 200,
  body: [
    { key_label: '环境', value: 'compose' },
    { key_label: '节点', value: 'local' },
  ],
});
const metaItems = meta.data?.metadata ?? [];
check(
  '元数据 KV 写入并回读内容（不是只数条数）',
  metaItems.length === 2 &&
    metaItems.some((m) => m.key_label === '环境' && m.value === 'compose') &&
    metaItems.some((m) => m.key_label === '节点' && m.value === 'local'),
  JSON.stringify(metaItems.map((m) => `${m.key_label}=${m.value}`)),
);
await req('PUT', `/admin/projects/${projectId}/metadata`, { token, expect: 400, body: [{ key_label: 'dup', value: '1' }, { key_label: 'dup', value: '2' }] });

const shots = await req('PUT', `/admin/projects/${projectId}/screenshots`, {
  token,
  expect: 200,
  body: [{ url: 'https://example.com/shot-1.png', caption: '首页截图' }],
});
const shotItems = shots.data?.screenshots ?? [];
check(
  '截图写入并回读内容',
  shotItems.length === 1 && shotItems[0].url === 'https://example.com/shot-1.png' && shotItems[0].caption === '首页截图' && shotItems[0].sort === 0,
  JSON.stringify(shotItems),
);
const detailShots = await req('GET', `/projects/${SLUG}`, { expect: 200 });
check('前台详情带 screenshots', (detailShots.data?.screenshots ?? []).length === 1, JSON.stringify(detailShots.data?.screenshots));

// ---- 11. B16 链接重检：私网必须 failed，且不发请求 ----
const privCheck = await req('POST', `/admin/links/${privLink.id}/check`, { token, expect: 200 });
check('私网链接被判 failed', privCheck.data?.last_status === 'failed', JSON.stringify({ s: privCheck.data?.last_status, h: privCheck.data?.last_http_status }));
check('被判 failed 时没有 HTTP 状态码', privCheck.data?.last_http_status === null, `last_http_status=${privCheck.data?.last_http_status}`);
check('重检写入 last_checked_at', Boolean(privCheck.data?.last_checked_at), `${privCheck.data?.last_checked_at}`);
if (CHECK_PUBLIC) {
  const pub = await req('POST', `/admin/links/${repoLink.id}/check`, { token, expect: 200 });
  check('公网链接重检有结果（ok/failed 都算，网络决定）', pub.data?.last_status === 'ok' || pub.data?.last_status === 'failed', `${pub.data?.last_status} / ${pub.data?.last_http_status}`);
} else {
  skip('公网链接重检（--public）', '未加 --public：离线/内网环境不该因为出网失败而红');
}
await req('POST', '/admin/links/not-a-real-id/check', { token, expect: 404 });

// ---- 12. 软删 / 恢复 ----
await req('DELETE', `/admin/projects/${projectId}`, { token, expect: 200 });
await req('GET', `/projects/${SLUG}`, { expect: 404 });
const afterDelete = await req('GET', `/admin/projects/${projectId}`, { token, expect: 200 });
check('软删后 deleted_at 有值', Boolean(afterDelete.data?.deleted_at), `deleted_at=${afterDelete.data?.deleted_at}`);
const kept = await req('GET', '/admin/projects?includeDeleted=1', { token, expect: 200 });
check('includeDeleted=1 能看到软删项目', (items(kept) ?? []).some((p) => p.id === projectId), `total=${kept.data?.total}`);
await req('POST', `/admin/projects/${projectId}/restore`, { token, expect: 200 });
await req('GET', `/projects/${SLUG}`, { expect: 200 });

// ---- 13. 契约错误信封 ----
const badSlug = await req('POST', '/admin/projects', { token, expect: 400, body: { name: 'x', slug: 'Bad_Slug' } });
check('非法 slug 的 error.code 是 VALIDATION_ERROR', badSlug.data?.error?.code === 'VALIDATION_ERROR', JSON.stringify(badSlug.data?.error));
// 非法跃迁要用一个仍为草稿的项目（上面的项目此时已是 published：published→archived 合法）
const badTransition = await req('PATCH', `/admin/projects/${transId}`, { token, expect: 400, body: { publish_status: 'archived' } });
check('非法状态跃迁被拒（draft→archived）', badTransition.data?.error?.code === 'INVALID_STATUS_TRANSITION', JSON.stringify(badTransition.data?.error));
// published → archived 是合法跃迁，确认服务端不是一刀切拒绝
const archived = await req('PATCH', `/admin/projects/${projectId}`, { token, expect: 200, body: { publish_status: 'archived' } });
check('published→archived 合法', archived.data?.publish_status === 'archived', `publish_status=${archived.data?.publish_status}`);
await req('GET', `/projects/${SLUG}`, { expect: 404 });
await req('GET', '/projects/definitely-not-here', { expect: 404 });
await req('GET', '/admin/projects', { expect: 401 });

// ---- 14. 收尾：软删本脚本建的项目（默认做，避免在被复用的库上累积脏数据） ----
if (KEEP_DATA) {
  skip('清理本脚本建的项目（--keep-data）', `保留 ${SLUG} / ${otherSlug} / ${SLUG}-trans`);
} else {
  for (const id of [projectId, otherId, transId]) {
    if (!id) continue;
    await req('DELETE', `/admin/projects/${id}`, { token, expect: 200 });
  }
  const afterCleanup = await req('GET', `/projects/${otherSlug}`, { expect: 404 });
  check('收尾软删生效（对照项目已不可见）', afterCleanup.status === 404, `status=${afterCleanup.status}`);
}

console.log(
  `\n${failed === 0 ? '全部通过' : `${failed} 项失败`} — 通过 ${passed} 项 / 失败 ${failed} 项 / 跳过 ${skipped} 项（${BASE}）`,
);
console.log(`注意：跳过项不等于通过项，别把「通过 ${passed} 项」当成覆盖了全部断言。`);
process.exit(failed === 0 ? 0 : 1);
