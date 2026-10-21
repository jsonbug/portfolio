import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY } from '@/api/client'
import * as projectsApi from '@/api/projects'
import { resetMockDb } from '@/mocks'
import ProjectListView from './ProjectListView.vue'

function renderList() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/projects', name: 'admin-projects', component: ProjectListView },
      { path: '/admin/projects/new', name: 'admin-project-new', component: { template: '<div>new</div>' } },
      { path: '/admin/projects/:id', name: 'admin-project-edit', component: { template: '<div>edit</div>' } },
    ],
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  return render(ProjectListView, { global: { plugins: [pinia, router] } })
}

async function findRow(name: string): Promise<HTMLElement> {  const rows = await screen.findAllByRole('row')
  const row = rows.find((tr) => within(tr).queryByText(name) !== null)
  expect(row, `未找到项目行「${name}」`).toBeTruthy()
  return row as HTMLElement
}

describe('ProjectListView', () => {
  const originalInnerWidth = window.innerWidth

  async function setWidth(width: number) {
    window.innerWidth = width
    window.dispatchEvent(new Event('resize'))
    await waitFor(() => expect(window.innerWidth).toBe(width))
  }

  function headers(): string[] {
    return screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim() ?? '')
      .filter((text) => text !== '')
  }

  beforeEach(() => {
    // 桌面默认档（≥1280 全 7 列）；各宽度用例自己改。
    window.innerWidth = 1440
    localStorage.setItem(AUTH_TOKEN_KEY, 'mock-token-test')
    resetMockDb()
  })

  afterEach(() => {
    window.innerWidth = originalInnerWidth
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('渲染全部项目（含草稿与软删除，后台默认可见）', async () => {
    renderList()
    expect(screen.getByRole('heading', { name: '项目管理' })).toBeInTheDocument()
    expect(await screen.findByText('项目展示平台')).toBeInTheDocument()
    expect(screen.getByText('Chart Kit')).toBeInTheDocument()
    expect(screen.getByText('还没想好的东西')).toBeInTheDocument()
    expect(screen.getByText('旧博客')).toBeInTheDocument()
    expect(screen.getByText('被软删的工具')).toBeInTheDocument()
  })

  it('曝光状态与进展分别以徽标呈现（形态 + 文字）', async () => {
    renderList()
    const portfolio = await findRow('项目展示平台')
    expect(within(portfolio).getByText('已发布')).toBeInTheDocument()
    expect(within(portfolio).getByText('进行中')).toBeInTheDocument()

    const chart = await findRow('Chart Kit')
    expect(within(chart).getByText('已发布')).toBeInTheDocument()
    expect(within(chart).getByText('已上线')).toBeInTheDocument()

    expect(within(await findRow('还没想好的东西')).getByText('草稿')).toBeInTheDocument()
    expect(within(await findRow('旧博客')).getByText('已归档')).toBeInTheDocument()
    expect(within(await findRow('被软删的工具')).getByText('已删除')).toBeInTheDocument()
  })

  it('七数据列齐全：名称 / slug / 发布状态 / 进展 / 链接 / 更新时间 / 操作', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())
    // 复选框是工具列，不算 7 数据列
    expect(headers).toEqual([
      '',
      '名称',
      'slug',
      '发布状态',
      '进展',
      '链接',
      '更新时间',
      '操作',
    ])

    const row = await findRow('项目展示平台')
    expect(within(row).getByText('/projects/portfolio-platform')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '仓库（新窗口打开）' })).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '官网（新窗口打开）' })).toBeInTheDocument()
  })

  it('四段顺序为 全部 / 已发布 / 草稿 / 已归档，计数取自后台 counts', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const group = screen.getByRole('group', { name: '按发布状态筛选' })
    const labels = within(group)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.replace(/\s+/g, '') ?? '')
    // 种子：6 个项目 = 全部 6 / 草稿 1 / 已发布 4 / 已归档 1
    expect(labels).toEqual(['全部6', '已发布4', '草稿1', '已归档1'])
    // 默认选中「全部」
    expect(within(group).getByRole('button', { name: '全部 6' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('分段带计数，点击「草稿」只留草稿（计数不随分段变化）', async () => {
    renderList()
    await screen.findByText('项目展示平台')

    // 计数由后端 counts 给，与分段无关：切换分段后仍是同一个数
    const draftSegment = () => screen.getByRole('button', { name: /^草稿 \d+$/ })
    const before = draftSegment().textContent
    await fireEvent.click(draftSegment())

    await waitFor(async () => {
      expect(await findRow('还没想好的东西')).toBeInTheDocument()
    })
    expect(screen.queryByText('Chart Kit')).not.toBeInTheDocument()
    expect(draftSegment().textContent).toBe(before)
    expect(screen.getByRole('button', { name: /^全部 \d+$/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(draftSegment()).toHaveAttribute('aria-pressed', 'true')
  })

  it('链接列：检查失败的入口仍可见但降级（⚠ + 说明），unknown 不降级', async () => {
    renderList()
    const chart = await findRow('Chart Kit')
    // 种子里 Chart Kit 的 docs 链接 last_status = failed
    const failed = within(chart)
      .getAllByTitle(/检查失败，可能已失效/)
      .at(0)
    expect(failed).toBeInTheDocument()

    const portfolio = await findRow('项目展示平台')
    const okEntry = within(portfolio).getByRole('link', { name: '仓库（新窗口打开）' })
    expect(okEntry.className).not.toContain('entry--failed')
  })

  it('操作列是「编辑」文字链接 + 行尾 ⋯ 菜单（发布 / 归档 / 删除）', async () => {
    renderList()
    const draft = await findRow('还没想好的东西')
    // 编辑是链接样式按钮，不再是 btn 按钮
    expect(within(draft).getByRole('button', { name: '编辑' }).className).toContain('link-btn')

    await fireEvent.click(within(draft).getByRole('button', { name: /更多操作/ }))
    expect(within(draft).getByRole('menuitem', { name: '发布' })).toBeInTheDocument()
    expect(within(draft).queryByRole('menuitem', { name: '归档' })).not.toBeInTheDocument()

    const published = await findRow('项目展示平台')
    await fireEvent.click(within(published).getByRole('button', { name: /更多操作/ }))
    expect(within(published).getByRole('menuitem', { name: '归档' })).toBeInTheDocument()
    expect(within(published).getByRole('menuitem', { name: '删除' })).toBeInTheDocument()
  })

  it('删除需二次确认：取消不删，确认后软删除', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderList()
    const row = await findRow('项目展示平台')
    const delBtn = async () =>
      within(await findRow('项目展示平台')).getByRole('menuitem', { name: '删除' })
    const openMenu = async () => {
      await fireEvent.click(
        within(await findRow('项目展示平台')).getByRole('button', { name: /更多操作/ }),
      )
    }

    // 取消：不删除
    confirmSpy.mockReturnValue(false)
    await openMenu()
    await fireEvent.click(await delBtn())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(within(row).queryByText('已删除')).not.toBeInTheDocument()

    // 确认：软删除，行内出现「已删除」并出现「恢复」
    confirmSpy.mockReturnValue(true)
    await openMenu()
    await fireEvent.click(await delBtn())
    await waitFor(async () => {
      const deletedRow = await findRow('项目展示平台')
      expect(within(deletedRow).getByText('已删除')).toBeInTheDocument()
      await fireEvent.click(within(deletedRow).getByRole('button', { name: /更多操作/ }))
      expect(within(deletedRow).getByRole('menuitem', { name: '恢复' })).toBeInTheDocument()
    })
  })

  it('1280 全显；1120–1279 先隐「操作」', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    await setWidth(1280)
    await waitFor(() =>
      expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接', '更新时间', '操作']),
    )

    await setWidth(1279)
    await waitFor(() =>
      expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接', '更新时间']),
    )
  })

  it('逐级变窄按优先级依次隐藏：操作 → 更新时间 → 进展 → slug', async () => {
    renderList()
    await screen.findByText('项目展示平台')

    await setWidth(1119)
    await waitFor(() => expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接']))

    await setWidth(1023)
    await waitFor(() => expect(headers()).toEqual(['名称', 'slug', '发布状态', '链接']))

    await setWidth(767)
    await waitFor(() => expect(headers()).toEqual(['名称', '发布状态', '链接']))
  })

  it('隐藏列降级到别处：slug 与更新时间进名称下方，进展并入发布状态单元格', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    await setWidth(767)

    await waitFor(() => expect(headers()).toEqual(['名称', '发布状态', '链接']))
    const row = await findRow('项目展示平台')
    // slug 与更新时间合并成一行小字（不堆三行），笔记数恒在这里
    const subline = within(row).getByText((_, el) => el?.className === 'project-sub mono') ?? null
    expect(subline).not.toBeNull()
    const text = subline!.textContent ?? ''
    expect(text).toContain('/projects/portfolio-platform')
    expect(text).toMatch(/笔记 \d+/)
    expect(text).toMatch(/更新 /)
    expect(text.match(/\n/g)).toBeNull()
    // 进展徽标堆叠在发布状态单元格内
    expect(within(row).getByText('进行中')).toBeInTheDocument()
    expect(within(row).getByText('已发布')).toBeInTheDocument()
  })

  it('隐藏列只做减法，列序不重排；恒显列到 0 宽也在', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const narrow = await (async () => {
      await setWidth(320)
      await waitFor(() => expect(headers()).toEqual(['名称', '发布状态', '链接']))
      return headers()
    })()

    await setWidth(1440)
    const wide = await (async () => {
      await waitFor(() => expect(headers()).toHaveLength(7))
      return headers()
    })()

    expect(wide.filter((label) => narrow.includes(label))).toEqual(narrow)
  })

  it('页头：面包屑 + 导出 JSON（次）+ 新建项目（主）+ 说明副标题', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const crumbs = screen.getByRole('navigation', { name: '面包屑' })
    expect(crumbs.textContent).toContain('后台')
    expect(crumbs.textContent).toContain('项目')
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /新建项目/ })).toBeInTheDocument()
    expect(
      screen.getByText('分段的维度是「发布状态」，与「进展」正交。归档项目保留数据但前台不可见。'),
    ).toBeInTheDocument()
  })

  it('名称下方恒显示「笔记 N」（全宽也在）；口径是该项目全部笔记，与分段/搜索无关', async () => {
    renderList()
    const portfolio = await findRow('项目展示平台')
    // 种子：项目展示平台 3 篇（2 已发布 + 1 草稿）、Chart Kit 1 篇、抓取工具箱 0 篇
    expect(within(portfolio).getByText(/笔记 3/)).toBeInTheDocument()
    expect(within(await findRow('Chart Kit')).getByText(/笔记 1/)).toBeInTheDocument()
    expect(within(await findRow('抓取工具箱')).getByText(/笔记 0/)).toBeInTheDocument()

    // 切到「已归档」：旧博客的项目已归档、它的笔记在前台不可见，但 note_count 仍是 1
    await fireEvent.click(screen.getByRole('button', { name: /^已归档 \d+$/ }))
    await waitFor(async () => {
      expect(within(await findRow('旧博客')).getByText(/笔记 1/)).toBeInTheDocument()
    })
  })

  it('表头是 <th scope="col">，屏幕阅读器能按列播报', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(1)
    expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
  })

  it('更新时间用相对/紧凑格式（10-18 / 昨天），不是完整日期', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const lastCells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent?.trim() ?? ''),
      )
    // 更新时间列是倒数第二格（最后一格是操作）
    const updatedCells = lastCells.map((cells) => cells.at(-2) ?? '')
    expect(updatedCells.length).toBeGreaterThan(0)
    expect(updatedCells.every((text) => /^(今天|昨天|\d{2}-\d{2})$/.test(text))).toBe(true)
  })

  it('搜索框 placeholder、已选项计数与批量归档入口在分段条右侧', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    expect(screen.getByPlaceholderText('搜索名称 / slug')).toBeInTheDocument()
    expect(screen.getByText('已选 0 项')).toBeInTheDocument()
    const batch = screen.getByRole('button', { name: '批量归档' })
    expect(batch).toBeDisabled()

    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 项目展示平台' }))
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(batch).toBeEnabled()
  })

  it('批量归档：确认后把选中项全部归档', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('项目展示平台')
    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 项目展示平台' }))
    await fireEvent.click(screen.getByRole('button', { name: '批量归档' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByText('已选 0 项')).toBeInTheDocument()
    })
    const row = await findRow('项目展示平台')
    expect(within(row).getByText('已归档')).toBeInTheDocument()
  })

  it('表格页脚：总数 · 每页条数 · 前台可见性说明', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    expect(screen.getByText('共 6 个项目 · 每页 20 条 · 前台仅「已发布」可见')).toBeInTheDocument()
  })

  it('可见性口径面板三格与文案（与前台一致）', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    const panel = screen.getByRole('region', { name: '可见性口径（与前台一致）' })
    expect(within(panel).getByText('前台可见；未删除即参与列表与详情。')).toBeInTheDocument()
    expect(within(panel).getByText('前台不可见；改名不留旧 slug。')).toBeInTheDocument()
    expect(
      within(panel).getByText('前台不可见；数据与笔记保留，旧链接仍 301。'),
    ).toBeInTheDocument()
  })

  it('批量归档部分失败：逐条累计，文案列出失败项名称，成功项照常归档', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // 只让「抓取工具箱」这条 PATCH 失败，其余照常走 mock
    const realUpdate = projectsApi.updateProject
    const updateSpy = vi
      .spyOn(projectsApi, 'updateProject')
      .mockImplementation(async (id, patch) => {
        if (id === 'proj_crawler') throw new Error('炸了')
        return realUpdate(id, patch)
      })

    renderList()
    await screen.findByText('项目展示平台')
    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 项目展示平台' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 抓取工具箱' }))
    await fireEvent.click(screen.getByRole('button', { name: '批量归档' }))

    // 两条都发过请求（失败没有让循环提前结束）
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2))

    // 成功的一行确实变了
    const archivedRow = await findRow('项目展示平台')
    expect(within(archivedRow).getByText('已归档')).toBeInTheDocument()
    // 结论文案同时给出成功数与失败项名称
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('已归档 1 条，失败 1 条：抓取工具箱')
    // 失败项留在选择里，方便只重试它
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  })

  it('批量归档跳过已归档项：不发请求，文案注明跳过条数', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const updateSpy = vi.spyOn(projectsApi, 'updateProject')

    renderList()
    await screen.findByText('旧博客')
    // 旧博客种子就是 archived，勾它 + 一个已发布项
    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 旧博客' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '选择 项目展示平台' }))
    await fireEvent.click(screen.getByRole('button', { name: '批量归档' }))

    await waitFor(() => expect(screen.getByText(/已归档 1 条（已跳过 1 条已归档项）/)).toBeInTheDocument())
    // 只对真正需要归档的那一条发了 PATCH
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).toBe('proj_portfolio')
  })

  async function seedProjects(count: number) {
    for (let i = 0; i < count; i += 1) {
      await projectsApi.createProject({
        slug: `bulk-${i}`,
        name: `批量项目 ${i}`,
        publish_status: 'published',
      })
    }
  }

  it('末页被删空时自动回落到上一页（page 与分页控件不再自相矛盾）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // 种子已发布 4 个 + 17 个 = 21 条已发布，每页 20 → 「已发布」第 2 页只有 1 行
    await projectsApi.createProject({ slug: 'bulk-x', name: '批量项目 x', publish_status: 'published' })
    await seedProjects(16)
    renderList()
    await screen.findByText('项目展示平台')

    await fireEvent.click(screen.getByRole('button', { name: /^已发布 \d+$/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第 2 页，共 2 页' })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: '第 2 页，共 2 页' }))

    // 第 2 页唯一那行归档 → 它离开「已发布」过滤，该页变空
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第 2 页，共 2 页' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
    await fireEvent.click(screen.getByRole('checkbox', { name: /^选择 / }))
    await fireEvent.click(screen.getByRole('button', { name: '批量归档' }))

    // 回落：页码被拉回最后一页，且那一页有内容
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第 1 页，共 1 页' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
    expect(within(await findRow('项目展示平台')).getByText('项目展示平台')).toBeInTheDocument()
  })

  it('同值点击分段 = 回到第 1 页并重拉（早退会让这两个手势失效）', async () => {
    await seedProjects(15)
    renderList()
    await screen.findByText('项目展示平台')
    await fireEvent.click(screen.getByRole('button', { name: '第 2 页，共 2 页' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第 2 页，共 2 页' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })

    // 点「全部」——与当前分段同值
    await fireEvent.click(screen.getByRole('button', { name: /^全部 \d+$/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第 1 页，共 2 页' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
  })
})
