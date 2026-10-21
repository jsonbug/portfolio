import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY } from '@/api/client'
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
    expect(screen.getByRole('heading', { name: '项目列表' })).toBeInTheDocument()
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
    expect(within(row).getByText('portfolio-platform')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '仓库（新窗口打开）' })).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '官网（新窗口打开）' })).toBeInTheDocument()
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

  it('草稿项目提供「发布」操作，已发布项目提供「下架」', async () => {
    renderList()
    const draft = await findRow('还没想好的东西')
    expect(within(draft).getByRole('button', { name: '发布' })).toBeInTheDocument()

    const published = await findRow('项目展示平台')
    expect(within(published).getByRole('button', { name: '下架' })).toBeInTheDocument()
  })

  it('删除需二次确认：取消不删，确认后软删除', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderList()
    const row = await findRow('项目展示平台')
    const delBtn = () => within(row).getByRole('button', { name: '删除' })

    // 取消：不删除
    confirmSpy.mockReturnValue(false)
    await fireEvent.click(delBtn())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(within(row).queryByText('已删除')).not.toBeInTheDocument()

    // 确认：软删除，行内出现「已删除」并出现「恢复」
    confirmSpy.mockReturnValue(true)
    await fireEvent.click(delBtn())
    await waitFor(async () => {
      const deletedRow = await findRow('项目展示平台')
      expect(within(deletedRow).getByText('已删除')).toBeInTheDocument()
      expect(within(deletedRow).getByRole('button', { name: '恢复' })).toBeInTheDocument()
    })
  })

  it('767 隐最右一列「操作」，768 恢复且仍在最右', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接', '更新时间', '操作'])

    await setWidth(767)
    await waitFor(() =>
      expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接', '更新时间']),
    )

    await setWidth(768)
    await waitFor(() =>
      expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接', '更新时间', '操作']),
    )
  })

  it('逐级变窄按优先级依次隐藏：操作 → 更新时间 → 进展 → slug', async () => {
    renderList()
    await screen.findByText('项目展示平台')

    await setWidth(639)
    await waitFor(() =>
      expect(headers()).toEqual(['名称', 'slug', '发布状态', '进展', '链接']),
    )

    await setWidth(511)
    await waitFor(() => expect(headers()).toEqual(['名称', 'slug', '发布状态', '链接']))

    await setWidth(383)
    await waitFor(() => expect(headers()).toEqual(['名称', '发布状态', '链接']))
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
})
