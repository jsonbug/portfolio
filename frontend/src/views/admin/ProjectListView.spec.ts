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

async function findRow(name: string): Promise<HTMLElement> {
  const rows = await screen.findAllByRole('row')
  const row = rows.find((tr) => within(tr).queryByText(name) !== null)
  expect(row, `未找到项目行「${name}」`).toBeTruthy()
  return row as HTMLElement
}

describe('ProjectListView', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'mock-token-test')
    resetMockDb()
  })

  afterEach(() => {
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

  it('按曝光状态筛选只留对应项目', async () => {
    renderList()
    await screen.findByText('项目展示平台')
    await fireEvent.update(screen.getByLabelText('状态'), 'draft')
    await fireEvent.click(screen.getByRole('button', { name: '筛选' }))

    await waitFor(async () => {
      expect(await findRow('还没想好的东西')).toBeInTheDocument()
    })
    expect(screen.queryByText('Chart Kit')).not.toBeInTheDocument()
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
})
