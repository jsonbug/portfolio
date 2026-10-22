<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { createNote, getAdminNote, updateNote } from '@/api/notes'
import { listAdminProjects } from '@/api/projects'
import {
  NOTE_PUBLISH_STATUS_LABELS,
  type AdminProjectListItem,
  type NotePublishStatus,
} from '@/types'
import { readingTimeMinutes } from '@/utils/text'
import { renderMarkdown } from '@/utils/markdown'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'

const props = defineProps<{ id?: string }>()

const router = useRouter()
const isNew = computed(() => !props.id)

interface NoteForm {
  title: string
  slug: string
  project_id: string
  tags: string[]
  publish_status: NotePublishStatus
  body_md: string
}

const form = reactive<NoteForm>({
  title: '',
  slug: '',
  project_id: '',
  tags: [],
  publish_status: 'draft',
  body_md: '',
})
const saved = ref<NoteForm>({ ...form, tags: [] })
const projects = ref<AdminProjectListItem[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const mode = ref<'split' | 'preview'>('split')
const tagInput = ref('')

const dirty = computed(() => JSON.stringify(form) !== JSON.stringify(saved.value))
const { showLeavePrompt, ask, confirmLeave, stayHere } = useUnsavedChanges(dirty)

const wordCount = computed(() => form.body_md.replace(/\s/g, '').length)
const readMinutes = computed(() => readingTimeMinutes(form.body_md))
const previewHtml = computed(() => renderMarkdown(form.body_md))

const editor = ref<HTMLTextAreaElement | null>(null)

/** 工具栏：在光标处套用 Markdown 记号（不引第三方编辑器，保持依赖面最小）。 */
function applySnippet(before: string, after = '', placeholder = '文本') {
  const el = editor.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = form.body_md.slice(start, end) || placeholder
  const next = `${form.body_md.slice(0, start)}${before}${selected}${after}${form.body_md.slice(end)}`
  form.body_md = next
  requestAnimationFrame(() => {
    el.focus()
    el.selectionStart = start + before.length
    el.selectionEnd = start + before.length + selected.length
  })
}

const TOOLS = [
  { label: 'H2', aria: '二级标题', before: '## ', after: '', placeholder: '小标题' },
  { label: 'B', aria: '加粗', before: '**', after: '**', placeholder: '加粗文字' },
  { label: 'I', aria: '斜体', before: '*', after: '*', placeholder: '斜体文字' },
  { label: '</>', aria: '行内代码', before: '`', after: '`', placeholder: 'code' },
  { label: '🔗', aria: '链接', before: '[', after: '](https://)', placeholder: '链接文字' },
  { label: '❝', aria: '引用', before: '> ', after: '', placeholder: '引用' },
  { label: '•', aria: '无序列表', before: '- ', after: '', placeholder: '列表项' },
  { label: '1.', aria: '有序列表', before: '1. ', after: '', placeholder: '列表项' },
  { label: '🖼', aria: '插入图片', before: '![', after: '](https://)', placeholder: '图片说明' },
] as const

function addTag() {
  const value = tagInput.value.trim()
  if (!value || form.tags.includes(value) || form.tags.length >= 20) {
    tagInput.value = ''
    return
  }
  form.tags.push(value)
  tagInput.value = ''
}

function removeTag(tag: string) {
  form.tags = form.tags.filter((item) => item !== tag)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const projectsRes = await listAdminProjects({ includeDeleted: true, page: 1, pageSize: 100 })
    projects.value = projectsRes.items
    if (isNew.value) {
      form.project_id = projectsRes.items[0]?.id ?? ''
      return
    }
    const note = await getAdminNote(props.id as string)
    form.title = note.title
    form.slug = note.slug
    form.project_id = note.project_id
    form.tags = [...note.tags]
    form.publish_status = note.publish_status
    form.body_md = note.body_md
    saved.value = { ...form, tags: [...form.tags] }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function persist(publishStatus: NotePublishStatus) {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const payload = {
      slug: form.slug,
      title: form.title,
      project_id: form.project_id,
      tags: [...form.tags],
      publish_status: publishStatus,
      body_md: form.body_md,
    }
    const note = isNew.value
      ? await createNote(payload)
      : await updateNote(props.id as string, {
          slug: payload.slug,
          title: payload.title,
          tags: payload.tags,
          publish_status: publishStatus,
          body_md: payload.body_md,
        })
    form.publish_status = note.publish_status
    saved.value = { ...form, tags: [...form.tags] }
    notice.value = publishStatus === 'published' ? '已发布' : '已保存草稿'
    if (isNew.value) {
      void router.replace({ name: 'admin-note-edit', params: { id: note.id } })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/** 放弃修改：回到已保存的快照；新建态直接回项目列表。 */
function discard() {
  if (isNew.value) {
    void router.push({ name: 'admin-projects' })
    return
  }
  form.title = saved.value.title
  form.slug = saved.value.slug
  form.project_id = saved.value.project_id
  form.tags = [...saved.value.tags]
  form.publish_status = saved.value.publish_status
  form.body_md = saved.value.body_md
}

onBeforeRouteLeave(async () => await ask())

onMounted(() => void load())
</script>

<template>
  <div class="note-editor">
    <header class="topbar">
      <nav class="crumbs" aria-label="面包屑">
        <span>后台</span>
        <span aria-hidden="true">/</span>
        <RouterLink :to="{ name: 'admin-projects' }">笔记</RouterLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">编辑</span>
      </nav>
      <span v-if="dirty" class="dirty-pill">未保存的修改</span>

      <div class="topbar-actions">
        <button class="btn btn-ghost" type="button" @click="discard">放弃</button>
        <button class="btn" type="button" :disabled="saving" @click="persist('draft')">
          保存草稿
        </button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="saving"
          @click="persist('published')"
        >
          发布笔记
        </button>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <div class="columns">
      <section class="pane pane-form" aria-label="笔记属性">
        <label class="field">
          <span class="field-label">标题 <span aria-hidden="true">*</span></span>
          <input v-model="form.title" class="input" type="text" maxlength="200" />
        </label>

        <label class="field">
          <span class="field-label">slug <span aria-hidden="true">*</span></span>
          <input v-model="form.slug" class="input" type="text" />
          <span class="field-hint mono">/notes/{{ form.slug }} · 发布后改 slug 旧地址 301</span>
        </label>

        <label class="field">
          <span class="field-label">所属项目 <span aria-hidden="true">*</span></span>
          <select v-model="form.project_id" class="select">
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </label>

        <div class="field">
          <span class="field-label" id="tags-label">标签</span>
          <div class="tags" role="group" aria-labelledby="tags-label">
            <span v-for="tag in form.tags" :key="tag" class="tag">
              {{ tag }}
              <button class="tag-remove" type="button" :aria-label="`移除标签 ${tag}`" @click="removeTag(tag)">
                ×
              </button>
            </span>
            <input
              v-model="tagInput"
              class="tag-input"
              type="text"
              placeholder="回车添加"
              aria-label="添加标签"
              @keydown.enter.prevent="addTag"
            />
          </div>
        </div>

        <div class="field">
          <span class="field-label">发布状态</span>
          <div class="segments" role="group" aria-label="发布状态">
            <button
              v-for="value in (['draft', 'published'] as const)"
              :key="value"
              class="segment"
              type="button"
              :class="{ 'segment--active': form.publish_status === value }"
              :aria-pressed="form.publish_status === value"
              @click="form.publish_status = value"
            >
              {{ NOTE_PUBLISH_STATUS_LABELS[value] }}
            </button>
          </div>
          <span class="field-hint">
            {{ form.publish_status === 'draft' ? '草稿仅后台可见；发布后出现在 /notes 与项目详情' : '已发布：/notes 与项目详情可见' }}
          </span>
        </div>

        <div class="form-meta">
          <span class="tabular-nums">{{ wordCount.toLocaleString('en-US') }} 字</span>
          <span>·</span>
          <span>阅读约 {{ readMinutes }} 分钟</span>
        </div>
      </section>

      <section class="pane pane-editor" aria-label="Markdown 编辑">
        <div class="editor-toolbar">
          <div class="tools" role="toolbar" aria-label="Markdown 工具栏">
            <button
              v-for="tool in TOOLS"
              :key="tool.aria"
              class="tool"
              type="button"
              :aria-label="tool.aria"
              @click="applySnippet(tool.before, tool.after, tool.placeholder)"
            >
              {{ tool.label }}
            </button>
          </div>
          <div class="mode" role="group" aria-label="预览模式">
            <button
              class="mode-btn"
              type="button"
              :aria-pressed="mode === 'split'"
              :class="{ 'mode-btn--active': mode === 'split' }"
              @click="mode = 'split'"
            >
              分屏
            </button>
            <button
              class="mode-btn"
              type="button"
              :aria-pressed="mode === 'preview'"
              :class="{ 'mode-btn--active': mode === 'preview' }"
              @click="mode = 'preview'"
            >
              预览
            </button>
          </div>
        </div>
        <textarea
          ref="editor"
          v-model="form.body_md"
          class="editor"
          aria-label="正文 Markdown"
        ></textarea>
        <div class="statusbar">
          <span>Markdown · 自动保存关闭 · ⌘S 保存草稿</span>
          <span class="tabular-nums">{{ dirty ? '未保存 1 处修改' : '已保存' }}</span>
        </div>
      </section>

      <aside
        v-if="mode === 'split'"
        class="pane pane-preview"
        role="complementary"
        aria-label="实时预览"
      >
        <p class="preview-label">实时预览</p>
        <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 内部已 DOMPurify 消毒 -->
        <article class="markdown" v-html="previewHtml"></article>
      </aside>
    </div>

    <div v-if="showLeavePrompt" class="leave-prompt" role="alertdialog" aria-modal="true">
      <p class="leave-text">这篇笔记有 1 处未保存的修改（正文）。</p>
      <div class="leave-actions">
        <button class="btn" type="button" @click="stayHere">留下继续编辑</button>
        <button class="btn btn-danger" type="button" @click="confirmLeave">放弃并离开</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-24);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.crumbs {
  display: flex;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.crumbs a {
  color: var(--c-text-secondary);
  text-decoration: none;
}
.dirty-pill {
  padding: 2px 10px;
  font-size: var(--fs-mono);
  color: var(--c-warning);
  background: #fdf3d8;
  border-radius: var(--r-pill);
}
.topbar-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-8);
}
.error,
.notice {
  margin: var(--space-8) var(--space-24) 0;
  padding: 8px 12px;
  border-radius: var(--r-control);
}
.error {
  color: var(--c-danger);
  background: var(--c-fill);
}
.notice {
  color: var(--c-success);
  background: var(--c-fill);
}

.columns {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.pane {
  padding: var(--space-24);
  border-right: 1px solid var(--c-border);
  min-width: 0;
}
.pane-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}
.pane-editor {
  display: flex;
  flex-direction: column;
  padding: 0;
}
.pane-preview {
  background: var(--c-surface);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--fs-small);
  font-weight: 600;
  color: var(--c-ink);
}
.field-hint {
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}
.field-hint.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--c-control-border);
  border-radius: var(--r-control);
  min-height: var(--control-h);
  align-items: center;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: var(--fs-small);
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
  border-radius: var(--r-tag);
}
.tag-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.tag-input {
  flex: 1;
  min-width: 90px;
  border: none;
  outline: none;
  background: none;
  font: inherit;
  font-size: var(--fs-small);
}

.segments {
  display: inline-flex;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.segment {
  flex: 1;
  min-height: 32px;
  font-size: var(--fs-small);
  color: var(--c-text);
  background: transparent;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.segment--active {
  color: var(--c-primary-strong);
  background: var(--c-surface);
  box-shadow: var(--shadow-e1);
  font-weight: 600;
}

.form-meta {
  margin-top: auto;
  display: flex;
  gap: 6px;
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border-bottom: 1px solid var(--c-border);
}
.tools {
  display: flex;
  gap: 2px;
}
.tool {
  min-width: 30px;
  min-height: 30px;
  font-size: var(--fs-mono);
  color: var(--c-text);
  background: none;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.tool:hover {
  background: var(--c-fill);
}
.mode {
  display: inline-flex;
  padding: 2px;
  background: var(--c-fill);
  border-radius: var(--r-tag);
}
.mode-btn {
  min-height: 28px;
  padding: 0 10px;
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
  background: none;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.mode-btn--active {
  color: var(--c-ink);
  background: var(--c-surface);
  box-shadow: var(--shadow-e1);
}

.editor {
  flex: 1;
  min-height: 420px;
  padding: var(--space-24);
  border: none;
  outline: none;
  resize: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 24px;
  color: var(--c-text);
}
.statusbar {
  display: flex;
  justify-content: space-between;
  padding: var(--space-8) var(--space-12);
  border-top: 1px solid var(--c-border);
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}
.preview-label {
  margin: 0 0 var(--space-12);
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}

.leave-prompt {
  position: fixed;
  left: 50%;
  bottom: var(--space-24);
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-24);
  padding: var(--space-12) var(--space-24);
  color: var(--c-surface);
  background: var(--c-ink);
  border-radius: var(--r-overlay);
  box-shadow: var(--shadow-e3);
}
.leave-text {
  margin: 0;
  font-size: var(--fs-small);
}
.leave-actions {
  display: flex;
  gap: var(--space-8);
}

@media (max-width: 1279px) {
  .columns {
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .pane-preview {
    display: none;
  }
}
</style>
