import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY } from '@/api/client'
import { getMockDb } from '@/mocks/handlers'
import { resetMockDb } from '@/mocks'
import { listAdminNotes } from '@/api/notes'
import NoteEditView from './NoteEditView.vue'

async function renderEditor(props: { id?: string } = {}): Promise<{ router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/projects', name: 'admin-projects', component: { template: '<div>list</div>' } },
      {
        path: '/admin/notes/new',
        name: 'admin-note-new',
        component: NoteEditView,
      },
      {
        path: '/admin/notes/:id',
        name: 'admin-note-edit',
        component: NoteEditView,
        props: true,
      },
      { path: '/notes', name: 'notes', component: { template: '<div>public</div>' } },
    ],
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push(
    props.id ? { name: 'admin-note-edit', params: { id: props.id } } : { name: 'admin-note-new' },
  )
  await router.isReady()
  // 必须走 RouterView：onBeforeRouteLeave 只在被路由渲染的组件上生效。
  const Wrapper = defineComponent({ render: () => h(RouterView) })
  render(Wrapper, { global: { plugins: [pinia, router] } })
  return { router }
}

/** 取种子库里某项目的一篇笔记 id（id 是随机 uid，只能按 slug 查）。 */
async function seedNoteId(slug: string): Promise<string> {
  const res = await listAdminNotes({ pageSize: 100 })
  const note = res.items.find((item) => item.slug === slug)
  expect(note, `种子笔记 ${slug} 不存在`).toBeTruthy()
  return note!.id
}

describe('NoteEditView', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'mock-token-test')
    resetMockDb()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('加载既有笔记：标题 / slug / 所属项目 / 标签 / 状态 / 正文都回填', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })

    const title = (await screen.findByLabelText(/^标题/)) as HTMLInputElement
    await waitFor(() => expect(title.value).toBeTruthy())
    expect((screen.getByLabelText(/^slug/) as HTMLInputElement).value).toBe('why-mock-first')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('proj_portfolio')
    expect(screen.getByText('已保存')).toBeInTheDocument()
  })

  it('改动后出现「未保存的修改」药丸与状态栏计数，放弃可回到已保存快照', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })
    const title = (await screen.findByLabelText(/^标题/)) as HTMLInputElement
    await waitFor(() => expect(title.value).toBeTruthy())
    const original = title.value

    await fireEvent.update(title, '改过的标题')
    expect(screen.getByText('未保存的修改')).toBeInTheDocument()
    expect(screen.getByText('未保存 1 处修改')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    await waitFor(() => expect(title.value).toBe(original))
    expect(screen.queryByText('未保存的修改')).not.toBeInTheDocument()
  })

  it('保存草稿：PATCH 后脏标记消失、状态仍为草稿', async () => {
    const id = await seedNoteId('draft-outline')
    await renderEditor({ id })
    const title = (await screen.findByLabelText(/^标题/)) as HTMLInputElement
    await waitFor(() => expect(title.value).toBeTruthy())

    await fireEvent.update(title, '草稿改名')
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已保存草稿'))
    expect(screen.queryByText('未保存的修改')).not.toBeInTheDocument()
    const note = getMockDb().notes.find((item) => item.id === id)
    expect(note?.title).toBe('草稿改名')
    expect(note?.publish_status).toBe('draft')
  })

  it('发布笔记：draft → published 走状态机，计数与按钮态跟着变', async () => {
    const id = await seedNoteId('draft-outline')
    await renderEditor({ id })
    const noteSlug = (await screen.findByLabelText(/^slug/)) as HTMLInputElement
    await waitFor(() => expect(noteSlug.value).toBe('draft-outline'))

    expect(screen.getByRole('button', { name: '已发布' })).toHaveAttribute('aria-pressed', 'false')
    await fireEvent.click(screen.getByRole('button', { name: '已发布' }))
    await fireEvent.click(screen.getByRole('button', { name: '发布笔记' }))

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('已发布'),
    )
    const note = getMockDb().notes.find((item) => item.id === id)
    expect(note?.publish_status).toBe('published')
    expect(note?.published_at).toBeTruthy()
  })

  it('标签：回车添加、重复不入、可移除，保存时随 payload 提交', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })
    await screen.findByLabelText(/^标题/)
    const tagInput = screen.getByLabelText('添加标签')

    await fireEvent.update(tagInput, '契约')
    await fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(screen.getByText('契约')).toBeInTheDocument()

    // 重复标签不入
    await fireEvent.update(tagInput, '契约')
    await fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(screen.getAllByText('契约')).toHaveLength(1)

    await fireEvent.click(screen.getByRole('button', { name: '移除标签 契约' }))
    expect(screen.queryByText('契约')).not.toBeInTheDocument()
  })

  it('工具栏按钮在正文插入 Markdown 记号', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })
    await screen.findByLabelText(/^标题/)
    const body = screen.getByLabelText('正文 Markdown') as HTMLTextAreaElement

    await fireEvent.update(body, '')
    await fireEvent.click(screen.getByRole('button', { name: '二级标题' }))
    expect(body.value).toBe('## 小标题')
    await fireEvent.click(screen.getByRole('button', { name: '加粗' }))
    expect(body.value).toContain('**')
  })

  it('分屏模式渲染消毒后的实时预览；「预览」模式收起预览栏', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })
    await screen.findByLabelText(/^标题/)
    const body = screen.getByLabelText('正文 Markdown')
    await fireEvent.update(body, '## 小标题\n\n<script>alert(1)</script>正文')

    const preview = await screen.findByRole('complementary', { name: '实时预览' })
    await waitFor(() => expect(preview.querySelector('h2')?.textContent).toBe('小标题'))
    expect(preview.querySelector('script')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '分屏' }))
    expect(screen.getByRole('button', { name: '分屏' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('字数与阅读时长随正文变化（与详情页同一算法）', async () => {
    const id = await seedNoteId('why-mock-first')
    await renderEditor({ id })
    await screen.findByLabelText(/^标题/)
    const body = screen.getByLabelText('正文 Markdown')
    await fireEvent.update(body, '字'.repeat(600))

    await waitFor(() => expect(screen.getByText('600 字')).toBeInTheDocument())
    expect(screen.getByText('阅读约 2 分钟')).toBeInTheDocument()
  })

  it('有未保存修改时离开被拦：留下继续编辑则停在原页，放弃并离开才跳走', async () => {
    const id = await seedNoteId('why-mock-first')
    const { router } = await renderEditor({ id })
    const title = (await screen.findByLabelText(/^标题/)) as HTMLInputElement
    await waitFor(() => expect(title.value).toBeTruthy())
    await fireEvent.update(title, '有改动了')

    // 守卫会挂起导航直到用户选择，所以这里不能 await push
    const firstNav = router.push({ name: 'notes' })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('未保存的修改')

    await fireEvent.click(screen.getByRole('button', { name: '留下继续编辑' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(router.currentRoute.value.name).toBe('admin-note-edit')
    await firstNav

    const secondNav = router.push({ name: 'notes' })
    await screen.findByRole('alertdialog')
    await fireEvent.click(screen.getByRole('button', { name: '放弃并离开' }))
    await secondNav
    await waitFor(() => expect(router.currentRoute.value.name).toBe('notes'))
  })

  it('新建态：填完发布后 replace 到 /admin/notes/:id，避免留下「新建」历史', async () => {
    const { router } = await renderEditor()
    await screen.findByLabelText(/^标题/)
    await waitFor(() =>
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0),
    )
    await fireEvent.update(screen.getByLabelText(/^标题/), '新笔记')
    await fireEvent.update(screen.getByLabelText(/^slug/), 'brand-new-note')
    await fireEvent.update(screen.getByLabelText('正文 Markdown'), '正文内容')

    await fireEvent.click(screen.getByRole('button', { name: '发布笔记' }))
    await waitFor(() =>
      expect(router.currentRoute.value.name).toBe('admin-note-edit'),
    )
    expect(router.currentRoute.value.params.id).toBeTruthy()
  })
})
