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
    vi.restoreAllMocks()
  })

  it('渲染标题与种子项目', async () => {
    renderList()
    expect(screen.getByRole('heading', { name: '项目列表' })).toBeInTheDocument()
    expect(await screen.findByText('multica-demo')).toBeInTheDocument()
    expect(screen.getByText('chart-kit')).toBeInTheDocument()
    expect(screen.getByText('old-crawler')).toBeInTheDocument()
  })

  it('状态以圆点 + 文字双重呈现', async () => {
    renderList()
    expect(await screen.findByText('multica-demo')).toBeInTheDocument()
    // 在对应项目行内断言状态文案，避开筛选下拉中的同名选项
    expect(within(await findRow('multica-demo')).getByText('已发布')).toBeInTheDocument()
    expect(within(await findRow('chart-kit')).getByText('草稿')).toBeInTheDocument()
    expect(within(await findRow('old-crawler')).getByText('已下架')).toBeInTheDocument()
  })

  it('草稿项目提供「发布」操作', async () => {
    renderList()
    expect(await screen.findByText('chart-kit')).toBeInTheDocument()
    const row = await findRow('chart-kit')
    expect(within(row).getByRole('button', { name: '发布' })).toBeInTheDocument()
  })

  it('删除需二次确认：取消不删，确认后软删除', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderList()
    await screen.findByText('multica-demo')
    const row = await findRow('multica-demo')
    const delBtn = () => within(row).getByRole('button', { name: '删除' })

    // 取消：不删除
    confirmSpy.mockReturnValue(false)
    await fireEvent.click(delBtn())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(within(row).queryByText('已删除')).not.toBeInTheDocument()

    // 确认：软删除，行内出现「已删除」徽标
    confirmSpy.mockReturnValue(true)
    await fireEvent.click(delBtn())
    await waitFor(async () => {
      const deletedRow = await findRow('multica-demo')
      expect(within(deletedRow).getByText('已删除')).toBeInTheDocument()
    })
  })
})
