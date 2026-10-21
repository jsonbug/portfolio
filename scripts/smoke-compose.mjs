#!/usr/bin/env node
/**
 * compose 部署冒烟：对一套已经起来的 docker compose 环境跑完整业务链路。
 *
 *   docker compose up -d --build
 *   docker compose exec -T web true   # 等 healthy
 *   ADMIN_PASSWORD='你的管理员口令' node scripts/smoke-compose.mjs
 *
 * 可选参数（也可用环境变量）：
 *   --base   http://localhost:8080   前端入口（经 nginx 反代 /api/v1）
 *   --user   admin                   ADMIN_USERNAME
 *   --pass   -                       ADMIN_PASSWORD（缺省会直接报错退出）
 *   --slug   自定项目 slug（同库重复跑会冲突，默认带时间戳）
 *   --public 额外用 https://github.com/jsonbug/portfolio 做一次真实外网链接重检
 *            （默认不跑：离线/内网环境不该因为出网失败而红）
 *
 * 覆盖：nginx 静态托管与 history fallback → /api/v1 同源反代 → 登录 → 草稿不可见
 * → 发布后前台可见（列表/详情/笔记）→ 后台分段计数 → 元数据 KV → 软删/恢复
 * → B16 链接重检（含私网目标必须判 failed）→ 契约错误信封。
 *
 * 只用标准库，退出码非 0 表示失败，逐条打印 PASS/FAIL。
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

let failed = 0;
const ok = (name, extra = '') => console.log(`PASS  ${name}${extra ? ` — ${extra}` : ''}`);
const bad = (name, detail) => {
  failed += 1;
  console.log(`FAIL  ${name} — ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name, detail) : bad(name, detail));

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

// ---- 4. 新建草稿项目（含一条公网链接、一条私网链接、一条笔记草稿） ----
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
check('建项目请求体不含链接（链接是独立资源）', (project.links ?? []).length === 0, `links=${(project.links ?? []).length}`);

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
check('链接返回 snake_case 字段', 'last_status' in repoLink && 'last_http_status' in repoLink, Object.keys(repoLink).join(','));
check('新建链接默认 unknown（自动检查是异步的）', ['unknown', 'ok'].includes(repoLink.last_status), `last_status=${repoLink.last_status}`);

const note = await req('POST', '/admin/notes', {
  token,
  expect: 201,
  body: { project_id: projectId, slug: `${SLUG}-note`, title: '部署笔记', body_md: '# 笔记正文', publish_status: 'draft' },
});
const noteId = note.data?.id;

// ---- 5. 草稿不可见 ----
const beforeList = await req('GET', '/projects', { expect: 200 });
check('草稿不出现在前台列表', !(beforeList.data?.items ?? []).some((p) => p.slug === SLUG), `total=${beforeList.data?.total}`);
await req('GET', `/projects/${SLUG}`, { expect: 404 });
const draftedNotes = await req('GET', '/notes', { expect: 200 });
check('草稿笔记不出现在前台 /notes', !(draftedNotes.data?.items ?? []).some((n) => n.slug === `${SLUG}-note`), `total=${draftedNotes.data?.total}`);

// ---- 6. 发布（项目 + 笔记） ----
const published = await req('PATCH', `/admin/projects/${projectId}`, { token, expect: 200, body: { publish_status: 'published' } });
check('项目发布后 published_at 有值', published.data?.publish_status === 'published' && Boolean(published.data?.published_at), `published_at=${published.data?.published_at}`);
await req('PATCH', `/admin/notes/${noteId}`, { token, expect: 200, body: { publish_status: 'published' } });

// ---- 7. 前台可见（列表 / 详情 / 笔记 / 排序 / 过滤） ----
const afterList = await req('GET', '/projects', { expect: 200 });
check('发布后出现在前台列表', (afterList.data?.items ?? []).some((p) => p.slug === SLUG), `total=${afterList.data?.total}`);
const detail = await req('GET', `/projects/${SLUG}`, { expect: 200 });
check('详情按 slug 命中', detail.data?.slug === SLUG, `slug=${detail.data?.slug}`);
check('详情带 Markdown 原文与链接', typeof detail.data?.description_md === 'string' && (detail.data?.links ?? []).length === 2, `links=${(detail.data?.links ?? []).length}`);
check('详情笔记含已发布那条', (detail.data?.notes ?? []).some((n) => n.slug === `${SLUG}-note`), JSON.stringify((detail.data?.notes ?? []).map((n) => n.slug)));
await req('GET', '/notes', { expect: 200 });
await req('GET', '/notes?pageSize=100', { expect: 200 });
await req('GET', '/projects?progress=launched&sort=recent&page=1&pageSize=50', { expect: 200 });
await req('GET', '/projects?tech_stack=Vue%203', { expect: 200 });
await req('GET', `/notes/${SLUG}-note`, { expect: 200 });

// ---- 8. 后台：分段计数 / 详情 / 过滤 ----
const adminList = await req('GET', '/admin/projects', { token, expect: 200 });
const counts = adminList.data?.counts ?? {};
check('后台返回四段计数', ['all', 'draft', 'published', 'archived'].every((k) => typeof counts[k] === 'number'), JSON.stringify(counts));
check('counts.all = draft + published + archived', counts.all === counts.draft + counts.published + counts.archived, JSON.stringify(counts));
const adminDetail = await req('GET', `/admin/projects/${projectId}`, { token, expect: 200 });
check('后台详情笔记带 publish_status', (adminDetail.data?.notes ?? []).every((n) => typeof n.publish_status === 'string'), JSON.stringify((adminDetail.data?.notes ?? []).map((n) => n.publish_status)));
const draftOnly = await req('GET', '/admin/projects?publish_status=draft', { token, expect: 200 });
check('分段过滤不改 counts（仍是全部口径）', JSON.stringify(draftOnly.data?.counts ?? {}) === JSON.stringify(counts), JSON.stringify(draftOnly.data?.counts));
await req('GET', '/admin/notes', { token, expect: 200 });
await req('GET', '/admin/notes?publish_status=published', { token, expect: 200 });

// ---- 9. 元数据 KV（整体替换，body 是裸数组） ----
const meta = await req('PUT', `/admin/projects/${projectId}/metadata`, {
  token,
  expect: 200,
  body: [
    { key_label: '环境', value: 'compose' },
    { key_label: '节点', value: 'local' },
  ],
});
check('元数据 KV 写入并回读', (meta.data?.metadata ?? []).length === 2, JSON.stringify(meta.data?.metadata));
await req('PUT', `/admin/projects/${projectId}/metadata`, { token, expect: 400, body: [{ key_label: 'dup', value: '1' }, { key_label: 'dup', value: '2' }] });

// ---- 10. B16 链接重检：私网必须 failed，且不发请求 ----
const privCheck = await req('POST', `/admin/links/${privLink.id}/check`, { token, expect: 200 });
check('私网链接被判 failed', privCheck.data?.last_status === 'failed', JSON.stringify({ s: privCheck.data?.last_status, h: privCheck.data?.last_http_status }));
check('被判 failed 时没有 HTTP 状态码', privCheck.data?.last_http_status === null, `last_http_status=${privCheck.data?.last_http_status}`);
check('重检写入 last_checked_at', Boolean(privCheck.data?.last_checked_at), `${privCheck.data?.last_checked_at}`);
if (CHECK_PUBLIC) {
  const pub = await req('POST', `/admin/links/${repoLink.id}/check`, { token, expect: 200 });
  check('公网链接重检有结果（ok/failed 都算，网络决定）', pub.data?.last_status === 'ok' || pub.data?.last_status === 'failed', `${pub.data?.last_status} / ${pub.data?.last_http_status}`);
} else {
  ok('公网链接重检跳过（未加 --public，避免依赖出网）');
}
await req('POST', '/admin/links/not-a-real-id/check', { token, expect: 404 });

// ---- 11. 软删 / 恢复 ----
await req('DELETE', `/admin/projects/${projectId}`, { token, expect: 200 });
await req('GET', `/projects/${SLUG}`, { expect: 404 });
const afterDelete = await req('GET', `/admin/projects/${projectId}`, { token, expect: 200 });
check('软删后 deleted_at 有值', Boolean(afterDelete.data?.deleted_at), `deleted_at=${afterDelete.data?.deleted_at}`);
const kept = await req('GET', `/admin/projects?includeDeleted=1`, { token, expect: 200 });
check('includeDeleted=1 能看到软删项目', (kept.data?.items ?? []).some((p) => p.id === projectId), `total=${kept.data?.total}`);
await req('POST', `/admin/projects/${projectId}/restore`, { token, expect: 200 });
await req('GET', `/projects/${SLUG}`, { expect: 200 });

// ---- 12. 契约错误信封 ----
const badSlug = await req('POST', '/admin/projects', { token, expect: 400, body: { name: 'x', slug: 'Bad_Slug' } });
check('非法 slug 返回统一错误信封', typeof badSlug.data?.error?.code === 'string', JSON.stringify(badSlug.data?.error));
// 非法跃迁要用一个全新草稿项目：上面的项目此时已是 published（published→archived 合法）
const fresh = await req('POST', '/admin/projects', { token, expect: 201, body: { name: '跃迁校验', slug: `${SLUG}-trans` } });
const badTransition = await req('PATCH', `/admin/projects/${fresh.data?.id}`, { token, expect: 400, body: { publish_status: 'archived' } });
check('非法状态跃迁被拒（draft→archived）', badTransition.data?.error?.code === 'INVALID_STATUS_TRANSITION', JSON.stringify(badTransition.data?.error));
// published → archived 是合法跃迁，确认服务端不是一刀切拒绝
const archived = await req('PATCH', `/admin/projects/${projectId}`, { token, expect: 200, body: { publish_status: 'archived' } });
check('published→archived 合法', archived.data?.publish_status === 'archived', `publish_status=${archived.data?.publish_status}`);
await req('GET', `/projects/${SLUG}`, { expect: 404 });
await req('GET', '/projects/definitely-not-here', { expect: 404 });
await req('GET', '/admin/projects', { expect: 401 });

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}（${BASE}）`);
process.exit(failed === 0 ? 0 : 1);
