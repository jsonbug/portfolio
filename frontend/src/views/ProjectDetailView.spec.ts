import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { getMockDb, handleMockRequest, resetMockDb } from '@/mocks/handlers'
import ProjectDetailView from './ProjectDetailView.vue'

function renderDetail(slug: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/projects/:slug', name: 'project-detail', component: ProjectDetailView, props: true },
      { path: '/notes', name: 'notes', component: { template: '<div>notes</div>' } },
      { path: '/notes/:slug', name: 'note-detail', component: { template: '<div>note</div>' } },
    ],
  })
  return { router, ...render(ProjectDetailView, { props: { slug }, global: { plugins: [router] } }) }
}

const admin = (method: string, path: string, body?: unknown) =>
  handleMockRequest({
    method,
    path,
    query: new URLSearchParams(),
    headers: { authorization: 'Bearer mock-token-test' },
    body,
  })

/** 造一个「除了名字什么都没有」的已发布项目，用来验证空 panel 抑制。 */
async function seedBareProject(): Promise<void> {
  const created = admin('POST', '/admin/projects', { slug: 'bare-project', name: '极简项目' })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { id: string }
  expect(admin('PATCH', `/admin/projects/${body.id}`, { publish_status: 'published' }).status).toBe(200)
}

describe('ProjectDetailView', () => {
  beforeEach(() => resetMockDb())

  it('头部：名称、摘要、进展徽标与「star · 版本 · 更新时间」指标', async () => {
    renderDetail('portfolio-platform')

    expect(await screen.findByRole('heading', { level: 1, name: '项目展示平台' })).toBeInTheDocument()
    expect(screen.getByText('把散落在收藏夹里的项目收进一个可检索、可记笔记的展示站。')).toBeInTheDocument()
    // 进展徽标 + 元数据「进展」行都会出现「进行中」，这里只锚头部徽标
    expect(document.querySelector('.title-row .badge-text')?.textContent?.trim()).toBe('进行中')
    expect(screen.getByText('★ 128')).toBeInTheDocument()
    expect(screen.getByText('1.4.0')).toBeInTheDocument()
    expect(screen.getByText(/\d{4}-\d{2}-\d{2} 更新/)).toBeInTheDocument()
  })

  it('右栏三 panel：元数据（固定列 + 自定义 KV）/ 相关链接 / 技术栈', async () => {
    renderDetail('portfolio-platform')

    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    expect(within(aside).getByRole('heading', { name: '元数据' })).toBeInTheDocument()
    expect(within(aside).getByRole('heading', { name: '相关链接' })).toBeInTheDocument()
    expect(within(aside).getByRole('heading', { name: '技术栈' })).toBeInTheDocument()

    // 固定列：发布状态 + 进展 + 4 列（效果图的 6 行）
    expect(within(aside).getByText('发布状态')).toBeInTheDocument()
    expect(within(aside).getByText('进展')).toBeInTheDocument()
    expect(within(aside).getByText('前端负责人')).toBeInTheDocument()
    expect(within(aside).getByText('MIT')).toBeInTheDocument()
    expect(within(aside).getByText('2024')).toBeInTheDocument()
    expect(within(aside).getByText('2 人')).toBeInTheDocument()
    // 自定义 KV
    expect(within(aside).getByText('代码行数')).toBeInTheDocument()
    expect(within(aside).getByText('18k')).toBeInTheDocument()
    // 技术栈
    expect(within(aside).getByText('Vue 3')).toBeInTheDocument()
  })

  it('头部三个主操作：源码仓库 / 访问官网 / 查看笔记（与右栏清单并存）', async () => {
    renderDetail('portfolio-platform')
    await screen.findByRole('heading', { level: 1, name: '项目展示平台' })

    expect(screen.getByRole('link', { name: '源码仓库 · 项目展示平台（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://github.com/jsonbug/portfolio',
    )
    expect(screen.getByRole('link', { name: '访问官网 · 项目展示平台（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://portfolio.example.com',
    )
    // 查看笔记是页内锚点，落在右栏之外的「相关笔记」区
    const notesAction = screen.getByRole('link', { name: /查看笔记 · 项目展示平台/ })
    expect(notesAction).toHaveAttribute('href', '#related-notes')
    expect(document.getElementById('related-notes')).not.toBeNull()
  })

  it('相关笔记：日期 / 标题 / 摘要 / 标签 + 「全部笔记」入口', async () => {
    renderDetail('portfolio-platform')
    const section = (await screen.findByRole('heading', { name: '相关笔记' })).closest('section') as HTMLElement

    expect(within(section).getByRole('link', { name: 'v1.2 改造笔记' })).toBeInTheDocument()
    // excerpt 来自契约 v1.2.3 的 NoteSummary.excerpt
    expect(within(section).getByText(/曝光状态与进展拆成两个字段/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /全部笔记/ })).toHaveAttribute('href', '/notes')
  })

  it('F9：链接检查 failed 才降级（低对比 + 失效图标 + 说明），仍可点', async () => {
    renderDetail('chart-kit')
    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    const failed = within(aside).getByRole('link', { name: /^文档 · Chart Kit（新窗口打开），链接检查失败/ })

    expect(failed).toHaveClass('link-anchor--failed')
    expect(failed).toHaveAttribute('href', 'https://chart.example.com/docs')
    expect(failed).toHaveAttribute('title', '链接检查失败（HTTP 502），仍可尝试打开')
    expect(failed).toHaveTextContent('⚠')

    // 同页另一条 ok 链接不降级
    const ok = within(aside).getAllByRole('link').find((el) => !el.className.includes('failed'))
    expect(ok).toBeTruthy()
    expect(ok).not.toHaveClass('link-anchor--failed')
  })

  it('F9：unknown（从未检查）与 null 一律不降级', async () => {
    // 新建项目的链接 last_status 为 unknown
    const created = admin('POST', '/admin/projects', {
      slug: 'unknown-link-project',
      name: '未知状态项目',
      publish_status: 'published',
    })
    const { id } = (await created.json()) as { id: string }
    const added = admin('POST', `/admin/projects/${id}/links`, {
      type: 'repo',
      label: '代码',
      url: 'https://github.com/jsonbug/never-checked',
    })
    const link = (await added.json()) as { last_status: string | null }
    expect(link.last_status === 'unknown' || link.last_status === null).toBe(true)

    renderDetail('unknown-link-project')
    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    const repo = within(aside).getByRole('link', { name: '仓库 · 未知状态项目（新窗口打开）' })
    expect(repo).not.toHaveClass('link-anchor--failed')
    expect(repo).not.toHaveTextContent('⚠')
    expect(repo).not.toHaveAttribute('title')
  })

  it('非 http(s) 链接降级为纯文本（不再输出可点的 a）', async () => {
    const created = admin('POST', '/admin/projects', {
      slug: 'odd-link-project',
      name: '怪链接项目',
      publish_status: 'published',
    })
    const { id } = (await created.json()) as { id: string }
    // 绕过 API 校验，直接把库里链接改成非法地址（模拟历史脏数据）
    const link = (await (await admin('POST', `/admin/projects/${id}/links`, {
      type: 'repo',
      label: '代码',
      url: 'https://github.com/jsonbug/odd',
    })).json()) as { id: string }
    const db = getMockDb()
    const row = db.links.find((l) => l.id === link.id)
    if (row) row.url = 'javascript:alert(1)'

    renderDetail('odd-link-project')
    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    expect(within(aside).getByText('链接地址不合法，已停用')).toBeInTheDocument()
    expect(within(aside).queryByRole('link', { name: /仓库/ })).not.toBeInTheDocument()
  })

  it('旧 slug 301 后把地址栏收敛到规范 slug（别让人分享旧地址）', async () => {
    const { router } = renderDetail('multica-demo')
    await screen.findByRole('heading', { level: 1, name: '项目展示平台' })
    await waitFor(() => expect(router.currentRoute.value.params.slug).toBe('portfolio-platform'))
  })

  it('相关链接：类型文案 + 裸域名 + 新窗口 rel', async () => {
    renderDetail('portfolio-platform')

    const link = await screen.findByRole('link', { name: '仓库 · 项目展示平台（新窗口打开）' })
    expect(link).toHaveAttribute('href', 'https://github.com/jsonbug/portfolio')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('github.com')
    // 仓库 / 官网两类都在
    expect(screen.getByRole('link', { name: '官网 · 项目展示平台（新窗口打开）' })).toHaveTextContent(
      'portfolio.example.com',
    )
  })

  it('渲染 Markdown 介绍与相关笔记（草稿笔记不出现）', async () => {
    renderDetail('portfolio-platform')

    expect(await screen.findByText(/一页看清每个项目的进展/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '相关笔记' })).toBeInTheDocument()
    expect(screen.getByText('v1.2 改造笔记')).toBeInTheDocument()
    expect(screen.queryByText('（草稿）下一轮想做的事')).not.toBeInTheDocument()
  })

  it('空值不渲染：没有自定义 KV 就不出现那一行，且面板内只剩固定列', async () => {
    renderDetail('crawler-tools')

    const aside = await screen.findByRole('complementary', { name: '项目速览' })
    const meta = within(aside).getByRole('heading', { name: '元数据' }).closest('section') as HTMLElement
    expect(within(meta).getByText('独立开发')).toBeInTheDocument()
    expect(within(meta).queryByText('代码行数')).not.toBeInTheDocument()
    // summary/description 为 null 时不出对应区块
    expect(screen.queryByRole('heading', { name: '项目介绍' })).not.toBeInTheDocument()
    // label 为空时回退成裸域名
    const repoLink = within(aside).getAllByRole('link')[0]
    expect(repoLink).toHaveAttribute('href', 'https://github.com/jsonbug/crawler-tools')
    expect(repoLink).toHaveTextContent('github.com')
  })

  it('项目什么都没有时：侧栏只剩两行状态元数据，空 panel 不渲染', async () => {
    await seedBareProject()
    renderDetail('bare-project')

    expect(await screen.findByRole('heading', { level: 1, name: '极简项目' })).toBeInTheDocument()
    const aside = screen.getByRole('complementary', { name: '项目速览' })
    // 发布状态 / 进展 恒有，所以元数据 panel 一定在；其余两 panel 与空固定列不渲染
    expect(within(aside).getByRole('heading', { name: '元数据' })).toBeInTheDocument()
    expect(within(aside).getByText('发布状态')).toBeInTheDocument()
    expect(within(aside).getByText('进展')).toBeInTheDocument()
    expect(within(aside).queryByText('角色')).not.toBeInTheDocument()
    expect(within(aside).queryByRole('heading', { name: '相关链接' })).not.toBeInTheDocument()
    expect(within(aside).queryByRole('heading', { name: '技术栈' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '相关笔记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '项目介绍' })).not.toBeInTheDocument()
  })

  it('截图：一次一张 + 左右箭头 + 「截图 n / N」+ 图注（契约 4.1.1）', async () => {
    renderDetail('portfolio-platform')
    await screen.findByRole('heading', { level: 1, name: '项目展示平台' })

    const figure = screen.getByRole('group', { name: '项目截图' })
    const first = within(figure).getByRole('img')
    // 有图注 → alt 用图注；首图 eager
    expect(first).toHaveAttribute('alt', '项目列表：分段与筛选条')
    expect(first).toHaveAttribute('loading', 'eager')
    expect(within(figure).getByText('截图 1 / 2')).toBeInTheDocument()

    await fireEvent.click(within(figure).getByRole('button', { name: '下一张截图' }))
    const second = within(figure).getByRole('img')
    // 无图注 → alt 回退成「项目名 截图 n」，非首图 lazy
    expect(second).toHaveAttribute('alt', '项目展示平台 截图 2')
    expect(second).toHaveAttribute('loading', 'lazy')
    expect(within(figure).getByText('截图 2 / 2')).toBeInTheDocument()

    // 末张再「下一张」回到第一张（不越界、不置空）
    await fireEvent.click(within(figure).getByRole('button', { name: '下一张截图' }))
    expect(within(figure).getByText('截图 1 / 2')).toBeInTheDocument()
  })

  it('截图：过不了 safeHttpUrl 的历史脏数据整项不渲染', async () => {
    // 接口层已挡住非法 URL，但库里可能有历史数据——渲染侧再挡一次，不留裂图
    getMockDb().screenshots.push({
      id: 'shot_legacy',
      project_id: 'proj_portfolio',
      url: 'javascript:alert(1)',
      caption: '脏数据',
      sort: 9,
    })
    renderDetail('portfolio-platform')
    await screen.findByRole('heading', { level: 1, name: '项目展示平台' })

    const figure = screen.getByRole('group', { name: '项目截图' })
    expect(within(figure).getByText('截图 1 / 2')).toBeInTheDocument()
    expect(within(figure).queryByText('脏数据')).not.toBeInTheDocument()
    expect(figure.querySelectorAll('img')).toHaveLength(1)
  })

  it('指标：只取 metadata 里 kind=metric 的条目做统计格，最多 4 格', async () => {
    renderDetail('portfolio-platform')
    await screen.findByRole('heading', { level: 1, name: '项目展示平台' })

    const cells = screen.getAllByRole('listitem').filter((li) => li.classList.contains('metric-cell'))
    // 值 + 标签两段（模板里没有空格分隔，断言用各段文本更稳）
    expect(cells.map((li) => li.querySelector('.metric-value')?.textContent)).toEqual([
      '42 KB',
      '60 fps',
    ])
    expect(cells.map((li) => li.querySelector('.metric-label')?.textContent)).toEqual([
      'gzip 包体',
      '长音频渲染',
    ])

    // 右栏元数据 panel 只放 meta 条目：指标卡条目不能同时出现在两边
    const aside = screen.getByRole('complementary', { name: '项目速览' })
    expect(within(aside).getByText('代码行数')).toBeInTheDocument()
    expect(within(aside).queryByText('gzip 包体')).not.toBeInTheDocument()
  })

  it('零截图 + 零指标：两个区块都不渲染（不留空态框）', async () => {
    renderDetail('crawler-tools')
    await screen.findByRole('heading', { level: 1, name: '抓取工具箱' })

    expect(screen.queryByRole('group', { name: '项目截图' })).not.toBeInTheDocument()
    expect(screen.queryByText(/截图 \d+ \/ \d+/)).not.toBeInTheDocument()
    expect(document.querySelectorAll('.metric-cell')).toHaveLength(0)
  })

  it('旧 slug 301 后仍能渲染（mock 跟随重定向）', async () => {
    renderDetail('multica-demo')
    expect(await screen.findByRole('heading', { level: 1, name: '项目展示平台' })).toBeInTheDocument()
  })

  it('未公开项目返回 404 文案，不泄露存在性', async () => {
    for (const slug of ['draft-idea', 'old-blog', 'deleted-tool']) {
      const { unmount } = renderDetail(slug)
      expect(await screen.findByRole('alert')).toHaveTextContent('不存在')
      unmount()
    }
  })
})
