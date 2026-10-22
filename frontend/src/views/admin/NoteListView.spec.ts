import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleMockRequest, resetMockDb } from '@/mocks/handlers'
import NoteListView from './NoteListView.vue'

async function renderList() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/notes', name: 'admin-notes', component: NoteListView },
      { path: '/admin/notes/new', name: 'admin-note-new', component: { template: '<div>new</div>' } },
      { path: '/admin/notes/:id', name: 'admin-note-edit', component: { template: '<div>edit</div>' } },
    ],
  })
  await router.push('/admin/notes')
  await router.isReady()
  render(NoteListView, { global: { plugins: [router] } })
  return router
}

const admin = (method: string, path: string, body?: unknown) =>
  handleMockRequest({
    method,
    path,
    query: new URLSearchParams(),
    headers: { authorization: 'Bearer mock-token-test' },
    body,
  })

/** 数据行（跳过「加载中…」/空态那种整行 td）。 */
function dataRows(): HTMLElement[] {
  return [...document.querySelectorAll('tbody tr')].filter((tr) =>
    tr.querySelector('.cell-title'),
  ) as HTMLElement[]
}

function titles(): string[] {
  return dataRows().map((row) => row.querySelector('.note-title')?.textContent?.trim() ?? '')
}

async function waitForTitles(expected: string[]): Promise<void> {
  await waitFor(() => expect(titles()).toEqual(expected))
}

describe('后台笔记列表（03 稿）', () => {
  beforeEach(() => {
    resetMockDb()
    localStorage.setItem('portfolio.admin.token', 'mock-token-test')
  })

  it('列是「标题 / 所属项目 / 状态 / 更新时间 / 操作」', async () => {
    await renderList()
    const table = await screen.findByRole('table')
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim())).toEqual([
      '标题',
      '所属项目',
      '状态',
      '更新时间',
      '操作',
    ])
  })

  it('跨项目列出全部笔记，草稿也在（后台口径）', async () => {
    await renderList()
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))

    expect(titles()).toContain('v1.2 改造笔记')
    expect(titles()).toContain('Chart Kit 0.9 发布说明')

    const draft = dataRows().find((row) => row.textContent?.includes('下一轮想做的事'))
    expect(draft).not.toBeUndefined()
    expect(within(draft as HTMLElement).getByText('草稿')).toBeInTheDocument()
  })

  it('行尾「编辑」进编辑器（可访问名带标题）', async () => {
    const router = await renderList()
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))

    const row = dataRows().find((r) => r.textContent?.includes('v1.2 改造笔记')) as HTMLElement
    const link = within(row).getByRole('link', { name: '编辑笔记：v1.2 改造笔记' })

    await fireEvent.click(link)

    await waitFor(() => expect(router.currentRoute.value.name).toBe('admin-note-edit'))
    expect(router.currentRoute.value.params.id).toMatch(/^note_/)
  })

  it('项目筛选的下拉带计数（与前台笔记树同一份分组逻辑），换项目后只剩该项目的笔记', async () => {
    await renderList()
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))

    const select = screen.getByRole('combobox', { name: '按项目筛选' })
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: /项目展示平台（3）/ })).toBeInTheDocument(),
    )

    const chartOption = within(select).getByRole('option', { name: /Chart Kit（1）/ })
    await fireEvent.update(select, (chartOption as HTMLOptionElement).value)

    await waitForTitles(['Chart Kit 0.9 发布说明'])
  })

  it('状态分段只留草稿', async () => {
    await renderList()
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))

    await fireEvent.click(screen.getByRole('button', { name: '草稿' }))

    await waitFor(() => {
      const all = titles()
      expect(all.length).toBeGreaterThan(0)
      expect(all.every((title) => title.includes('下一轮想做的事'))).toBe(true)
    })
  })

  it('搜索无结果时给空态与「清除筛选」', async () => {
    await renderList()
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0))

    const box = screen.getByRole('searchbox', { name: '搜索笔记' })
    await fireEvent.update(box, '不存在的标题')
    await fireEvent.submit(box.closest('form') as HTMLFormElement)

    const emptyText = await screen.findByText('没有符合条件的笔记')
    const emptyCell = emptyText.closest('td') as HTMLElement
    // 筛选条与空态各有一个「清除筛选」，这里只断言空态里那个
    expect(within(emptyCell).getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
  })

  it('空态：无筛选且库里没有笔记时给「写第一篇」入口', async () => {
    // 先把种子笔记全部删掉（DELETE 是硬删，204）
    const all = handleMockRequest({
      method: 'GET',
      path: '/admin/notes',
      query: new URLSearchParams('page=1&pageSize=100'),
      headers: { authorization: 'Bearer mock-token-test' },
      body: undefined,
    })
    const body = (await all.json()) as { items: Array<{ id: string }> }
    expect(body.items.length).toBeGreaterThan(0)
    for (const note of body.items) admin('DELETE', `/admin/notes/${note.id}`)

    await renderList()

    expect(await screen.findByText('还没有笔记')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '写第一篇' })).toHaveAttribute('href', '/admin/notes/new')
  })

  it('分页口径与后台项目列表一致：默认 20/页，第 2 页只剩 1 篇', async () => {
    for (let i = 0; i < 21; i += 1) {
      admin('POST', '/admin/notes', {
        project_id: 'proj_portfolio',
        slug: `seed-note-${i}`,
        title: `批量笔记 ${i}`,
        body_md: `内容 ${i}`,
        publish_status: 'published',
      })
    }

    await renderList()
    await waitFor(() => expect(dataRows()).toHaveLength(20))
    expect(screen.getByText(/共 26 篇笔记 · 每页 20 条/)).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /第 2 页，共 2 页/ }))

    await waitFor(() => expect(dataRows()).toHaveLength(6))
  })
})
