<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createProject, getAdminProject, updateProject } from '@/api/projects'
import { addLink, deleteLink, updateLink } from '@/api/links'
import { deleteNote, upsertNote } from '@/api/notes'
import {
  LINK_TYPE_LABELS,
  PROJECT_LIFECYCLE_LABELS,
  PROJECT_STATUS_LABELS,
  type LinkType,
  type ProjectLifecycle,
  type ProjectStatus,
} from '@/types'

const props = defineProps<{ id?: string }>()

const router = useRouter()

const isNew = computed(() => !props.id)
const projectId = computed(() => props.id ?? '')

// ---------- 元数据 ----------
const meta = reactive({
  name: '',
  tagline: '',
  description: '',
  status: 'draft' as ProjectStatus,
  stars: null as number | null,
  role: '',
  projectStatus: '' as ProjectLifecycle | '',
  startDate: '',
  endDate: '',
  githubRepo: '',
  coverImage: '',
})
const techInput = ref('')

// ---------- 链接 ----------
interface LinkRow {
  id?: string
  type: LinkType
  label: string
  url: string
}
const links = ref<LinkRow[]>([])

// ---------- 笔记 ----------
const noteTitle = ref('')
const noteContent = ref('')

const loading = ref(false)
const error = ref('')
const metaSaving = ref(false)
const metaSaved = ref(false)
const linkSaving = ref(false)
const noteSaving = ref(false)
const notice = ref('')

function parseTech(input: string): string[] {
  return [...new Set(input.split(/[,，]/).map((s) => s.trim()).filter(Boolean))]
}

async function load() {
  if (!props.id) return
  loading.value = true
  error.value = ''
  try {
    const d = await getAdminProject(props.id)
    meta.name = d.name
    meta.tagline = d.tagline ?? ''
    meta.description = d.description ?? ''
    meta.status = d.status
    meta.stars = d.stars
    meta.role = d.role ?? ''
    meta.projectStatus = d.projectStatus ?? ''
    // <input type="date"> 只认 YYYY-MM-DD，后端可能返回完整 ISO 时间戳。
    meta.startDate = d.startDate ? d.startDate.slice(0, 10) : ''
    meta.endDate = d.endDate ? d.endDate.slice(0, 10) : ''
    meta.githubRepo = d.githubRepo ?? ''
    meta.coverImage = d.coverImage ?? ''
    techInput.value = d.technologies.join(', ')
    links.value = d.links.map((l) => ({ id: l.id, type: l.type, label: l.label ?? '', url: l.url }))
    noteTitle.value = d.note?.title ?? ''
    noteContent.value = d.note?.content ?? ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function saveMeta() {
  const name = meta.name.trim()
  if (!name) {
    error.value = '项目名称必填'
    return
  }
  metaSaving.value = true
  metaSaved.value = false
  error.value = ''
  const payload = {
    name,
    tagline: meta.tagline || null,
    description: meta.description || null,
    status: meta.status,
    stars: meta.stars,
    role: meta.role || null,
    projectStatus: meta.projectStatus || null,
    startDate: meta.startDate || null,
    endDate: meta.endDate || null,
    githubRepo: meta.githubRepo || null,
    coverImage: meta.coverImage || null,
    technologies: parseTech(techInput.value),
  }
  try {
    if (props.id) {
      await updateProject(props.id, payload)
    } else {
      const created = await createProject(payload)
      await router.replace({ name: 'admin-project-edit', params: { id: created.id } })
    }
    metaSaved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    metaSaving.value = false
  }
}

// ---------- 链接操作 ----------
function addLinkRow() {
  links.value.push({ type: 'other', label: '', url: '' })
}

async function saveLink(row: LinkRow, index: number) {
  if (!row.url.trim()) {
    error.value = '链接地址必填'
    return
  }
  linkSaving.value = true
  error.value = ''
  try {
    const payload = {
      type: row.type,
      label: row.label || null,
      url: row.url.trim(),
      sortOrder: index,
    }
    if (row.id) {
      await updateLink(row.id, payload)
    } else {
      await addLink(projectId.value, payload)
    }
    notice.value = '链接已保存'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    linkSaving.value = false
  }
}

async function removeLink(row: LinkRow) {
  if (!row.id) {
    links.value = links.value.filter((l) => l !== row)
    return
  }
  linkSaving.value = true
  error.value = ''
  try {
    await deleteLink(row.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败'
  } finally {
    linkSaving.value = false
  }
}

// ---------- 笔记操作 ----------
async function saveNote() {
  if (!noteTitle.value.trim() || !noteContent.value.trim()) {
    error.value = '笔记标题与正文均必填'
    return
  }
  noteSaving.value = true
  error.value = ''
  try {
    await upsertNote(projectId.value, { title: noteTitle.value.trim(), content: noteContent.value })
    notice.value = '笔记已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    noteSaving.value = false
  }
}

async function removeNote() {
  noteSaving.value = true
  error.value = ''
  try {
    await deleteNote(projectId.value)
    noteTitle.value = ''
    noteContent.value = ''
    notice.value = '笔记已删除'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败'
  } finally {
    noteSaving.value = false
  }
}

const statusOptions = Object.entries(PROJECT_STATUS_LABELS) as Array<[ProjectStatus, string]>
const lifecycleOptions = Object.entries(PROJECT_LIFECYCLE_LABELS) as Array<[ProjectLifecycle, string]>
const linkTypeOptions = Object.entries(LINK_TYPE_LABELS) as Array<[LinkType, string]>

onMounted(() => void load())
</script>

<template>
  <section class="editor">
    <header class="editor-header">
      <div>
        <h1>{{ isNew ? '新建项目' : `编辑：${meta.name || '…'}` }}</h1>
        <p class="subtitle">元数据、链接、笔记分区独立保存。</p>
      </div>
      <RouterLink class="btn" :to="{ name: 'admin-projects' }">返回列表</RouterLink>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <div v-else class="sections">
      <!-- 元数据 -->
      <section class="card section" aria-labelledby="meta-title">
        <h2 id="meta-title">元数据</h2>
        <div class="grid">
          <div class="field">
            <label class="field-label" for="name">名称 *</label>
            <input id="name" v-model="meta.name" class="input" type="text" placeholder="项目名称" />
          </div>
          <div class="field">
            <label class="field-label" for="tagline">简介</label>
            <input id="tagline" v-model="meta.tagline" class="input" type="text" placeholder="一句话简介（≤200 字）" />
          </div>
          <div class="field span-2">
            <label class="field-label" for="description">描述（Markdown）</label>
            <textarea id="description" v-model="meta.description" class="textarea" rows="6" placeholder="项目描述，支持 Markdown" />
          </div>
          <div class="field">
            <label class="field-label" for="status">发布状态</label>
            <select id="status" v-model="meta.status" class="select">
              <option v-for="[value, label] in statusOptions" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="stars">Star 数</label>
            <input id="stars" v-model.number="meta.stars" class="input" type="number" min="0" step="1" placeholder="手填" />
          </div>
          <div class="field">
            <label class="field-label" for="role">角色</label>
            <input id="role" v-model="meta.role" class="input" type="text" placeholder="如：全栈开发 / 维护者" />
          </div>
          <div class="field">
            <label class="field-label" for="lifecycle">项目状态</label>
            <select id="lifecycle" v-model="meta.projectStatus" class="select">
              <option value="">未设置</option>
              <option v-for="[value, label] in lifecycleOptions" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="startDate">开始日期</label>
            <input id="startDate" v-model="meta.startDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="endDate">结束日期</label>
            <input id="endDate" v-model="meta.endDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="githubRepo">GitHub 仓库</label>
            <input id="githubRepo" v-model="meta.githubRepo" class="input" type="text" placeholder="owner/repo（预留）" />
          </div>
          <div class="field">
            <label class="field-label" for="coverImage">封面图 URL</label>
            <input id="coverImage" v-model="meta.coverImage" class="input" type="url" placeholder="https://…（可选，留空用渐层兜底）" />
          </div>
          <div class="field span-2">
            <label class="field-label" for="tech">技术栈</label>
            <input id="tech" v-model="techInput" class="input" type="text" placeholder="逗号分隔，如：Vue, Node.js, TypeScript" />
          </div>
        </div>
        <div class="section-actions">
          <span v-if="metaSaved" class="notice-inline" role="status">已保存</span>
          <button class="btn btn-primary" type="button" :disabled="metaSaving" @click="saveMeta">
            {{ metaSaving ? '保存中…' : isNew ? '创建项目' : '保存元数据' }}
          </button>
        </div>
      </section>

      <!-- 链接 -->
      <section class="card section" aria-labelledby="links-title">
        <h2 id="links-title">链接</h2>
        <p v-if="isNew" class="hint">先创建项目，再添加链接。</p>
        <ul v-else class="links">
          <li v-for="(row, index) in links" :key="row.id ?? `new-${index}`" class="link-row">
            <select v-model="row.type" class="select link-type" aria-label="链接类型">
              <option v-for="[value, label] in linkTypeOptions" :key="value" :value="value">{{ label }}</option>
            </select>
            <input v-model="row.label" class="input link-label" type="text" placeholder="名称（可选）" />
            <input v-model="row.url" class="input link-url" type="url" placeholder="https://…" />
            <button class="btn" type="button" :disabled="linkSaving" @click="saveLink(row, index)">保存</button>
            <button class="btn btn-ghost" type="button" :disabled="linkSaving" @click="removeLink(row)">删除</button>
          </li>
        </ul>
        <button v-if="!isNew" class="btn" type="button" :disabled="linkSaving" @click="addLinkRow">添加链接</button>
      </section>

      <!-- 笔记 -->
      <section class="card section" aria-labelledby="note-title">
        <h2 id="note-title">笔记（1:1，纯 Markdown）</h2>
        <p v-if="isNew" class="hint">先创建项目，再编辑笔记。</p>
        <template v-else>
          <div class="field">
            <label class="field-label" for="noteTitle">笔记标题</label>
            <input id="noteTitle" v-model="noteTitle" class="input" type="text" placeholder="笔记标题（1..200）" />
          </div>
          <div class="field">
            <label class="field-label" for="noteContent">笔记正文</label>
            <textarea id="noteContent" v-model="noteContent" class="textarea" rows="12" placeholder="Markdown 正文" />
          </div>
          <div class="section-actions">
            <button class="btn btn-primary" type="button" :disabled="noteSaving" @click="saveNote">保存笔记</button>
            <button class="btn btn-danger" type="button" :disabled="noteSaving" @click="removeNote">删除笔记</button>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2);
}
.editor-header h1 {
  margin: 0;
  font-size: 28px;
  color: var(--c-ink);
}
.subtitle {
  margin: var(--sp-1) 0 0;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.error {
  margin: 0;
  padding: 8px 12px;
  color: var(--c-danger);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.notice {
  margin: 0;
  padding: 8px 12px;
  color: var(--c-success);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.hint {
  margin: 0;
  color: var(--c-text-secondary);
  font-size: 13px;
}
.sections {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.section {
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.section h2 {
  margin: 0;
  font-size: 18px;
  color: var(--c-ink);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--sp-2);
}
.span-2 {
  grid-column: span 2;
}
.section-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  justify-content: flex-end;
}
.notice-inline {
  font-size: 13px;
  color: var(--c-success);
}
.links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.link-row {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  align-items: center;
}
.link-type {
  width: 110px;
  flex: none;
}
.link-label {
  width: 160px;
  flex: none;
}
.link-url {
  flex: 1;
  min-width: 200px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
  .link-row {
    flex-direction: column;
    align-items: stretch;
  }
  .link-type,
  .link-label,
  .link-url {
    width: 100%;
  }
}
</style>
