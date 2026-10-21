import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { AUTH_TOKEN_KEY } from '@/api/client'
import { getMockDb, handleMockRequest, resetMockDb } from '@/mocks/handlers'
import ProjectEditView from './ProjectEditView.vue'

async function renderEditor(id?: string): Promise<{ router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/projects', name: 'admin-projects', component: { template: '<div>list</div>' } },
      { path: '/admin/projects/new', name: 'admin-project-new', component: ProjectEditView },
      {
        path: '/admin/projects/:id',
        name: 'admin-project-edit',
        component: ProjectEditView,
        props: true,
      },
      { path: '/projects/:slug', name: 'project-detail', component: { template: '<div>detail</div>' } },
    ],
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push(
    id ? { name: 'admin-project-edit', params: { id } } : { name: 'admin-project-new' },
  )
  await router.isReady()
  const Wrapper = defineComponent({ render: () => h(RouterView) })
  render(Wrapper, { global: { plugins: [pinia, router] } })
  return { router }
}

const screenshotsSection = () => screen.getByRole('region', { name: '截图' })
const metadataSection = () => screen.getByRole('region', { name: '自定义元数据' })

describe('ProjectEditView · 截图与元数据 kind（契约 4.1.1）', () => {
  beforeEach(() => {
    resetMockDb()
    localStorage.setItem(AUTH_TOKEN_KEY, 'mock-token-test')
  })

  it('加载已有截图：按 sort 排好，图注为空时输入框留空', async () => {
    await renderEditor('proj_portfolio')
    const section = within(await screen.findByRole('region', { name: '截图' }))

    await waitFor(() => expect(section.getAllByLabelText(/第 \d+ 张截图地址/)).toHaveLength(2))
    expect((section.getByLabelText('第 1 张截图地址') as HTMLInputElement).value).toBe(
      'https://cdn.example.com/portfolio-1.webp',
    )
    expect((section.getByLabelText('第 1 张图注') as HTMLInputElement).value).toBe(
      '项目列表：分段与筛选条',
    )
    // 无图注的第二张读出来是空串（不是 "null"）
    expect((section.getByLabelText('第 2 张图注') as HTMLInputElement).value).toBe('')
  })

  it('保存截图：整体替换并刷新 updated_at（切到前台即可见）', async () => {
    await renderEditor('proj_portfolio')
    const section = within(await screen.findByRole('region', { name: '截图' }))
    await waitFor(() => expect(section.getAllByLabelText(/第 \d+ 张截图地址/)).toHaveLength(2))

    const before = getMockDb()
      .projects.find((p) => p.id === 'proj_portfolio')!.updated_at

    await fireEvent.update(section.getByLabelText('第 2 张图注'), '第二张的图注')
    await fireEvent.click(section.getByRole('button', { name: '保存截图' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('截图已保存'))
    const db = getMockDb()
    expect(db.screenshots.filter((s) => s.project_id === 'proj_portfolio')).toHaveLength(2)
    expect(
      db.screenshots.find((s) => s.url === 'https://cdn.example.com/portfolio-2.webp')?.caption,
    ).toBe('第二张的图注')
    expect(db.projects.find((p) => p.id === 'proj_portfolio')!.updated_at).not.toBe(before)
  })

  it('上移 / 下移改的是数组顺序（整体替换下 sort 就是顺序）', async () => {
    await renderEditor('proj_portfolio')
    const section = within(await screen.findByRole('region', { name: '截图' }))
    await waitFor(() => expect(section.getAllByLabelText(/第 \d+ 张截图地址/)).toHaveLength(2))

    await fireEvent.click(section.getByRole('button', { name: '下移第 1 张' }))
    await fireEvent.click(section.getByRole('button', { name: '保存截图' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('截图已保存'))

    const rows = getMockDb()
      .screenshots.filter((s) => s.project_id === 'proj_portfolio')
      .sort((a, b) => a.sort - b.sort)
    expect(rows.map((s) => s.url)).toEqual([
      'https://cdn.example.com/portfolio-2.webp',
      'https://cdn.example.com/portfolio-1.webp',
    ])
  })

  it('指标卡到上限就在界面禁用「添加指标卡」，不等后端 400', async () => {
    await renderEditor('proj_portfolio')
    const section = within(await screen.findByRole('region', { name: '自定义元数据' }))

    // 种子 portfolio 已有 2 条 metric，正好到上限
    await waitFor(() => expect(section.getByRole('button', { name: /指标卡已满/ })).toBeDisabled())
    expect(section.getByText(/最多 2 条（当前 2）/)).toBeInTheDocument()
  })

  it('元数据行可切成指标卡，且长度上限随类型收紧', async () => {
    await renderEditor('proj_portfolio')
    const section = within(await screen.findByRole('region', { name: '自定义元数据' }))
    const kindSelect = (await section.findByLabelText('第 1 条类型')) as HTMLSelectElement

    // meta 行：键 50 / 值 500
    expect((section.getByLabelText('第 1 条键名') as HTMLInputElement).maxLength).toBe(50)
    expect((section.getByLabelText('第 1 条值') as HTMLInputElement).maxLength).toBe(500)

    // 先删掉一条 metric，腾出名额，再把第 1 条切成 metric
    await fireEvent.click(section.getAllByRole('button', { name: '删除' })[2])
    await fireEvent.update(kindSelect, 'metric')
    expect((section.getByLabelText('第 1 条键名') as HTMLInputElement).maxLength).toBe(16)
    expect((section.getByLabelText('第 1 条值') as HTMLInputElement).maxLength).toBe(12)

    await fireEvent.click(section.getByRole('button', { name: '保存自定义字段' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('自定义元数据已保存'))

    const rows = getMockDb().metadata.filter((m) => m.project_id === 'proj_portfolio')
    expect(rows.find((m) => m.key_label === '代码行数')?.kind).toBe('metric')
  })

  it('新建项目时不显示截图与元数据编辑区（先创建再补内容）', async () => {
    await renderEditor()
    expect(await screen.findByText('先创建项目，再添加截图。')).toBeInTheDocument()
    expect(within(screenshotsSection()).queryByRole('button', { name: '保存截图' })).toBeNull()
    expect(within(metadataSection()).queryByRole('button', { name: /添加/ })).toBeNull()
  })

  it('截图超过 10 张时接口 400，界面如实展示错误', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.webp`,
    }))
    const res = handleMockRequest({
      method: 'PUT',
      path: '/admin/projects/proj_portfolio/screenshots',
      query: new URLSearchParams(),
      headers: { authorization: 'Bearer mock-token-test' },
      body: rows,
    })
    expect(res.status).toBe(400)
    const envelope = (await res.json()) as { error: { code: string; details: unknown[] } }
    expect(envelope.error.code).toBe('VALIDATION_ERROR')
    expect(envelope.error.details).toHaveLength(1)
  })
})
