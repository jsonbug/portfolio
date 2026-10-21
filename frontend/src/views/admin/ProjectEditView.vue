<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  createProject,
  getAdminProject,
  replaceProjectMetadata,
  replaceProjectScreenshots,
  updateProject,
} from '@/api/projects'
import { addLink, deleteLink, updateLink } from '@/api/links'
import { listAdminNotes } from '@/api/notes'
import {
  LINK_TYPE_LABELS,
  PROGRESS_LABELS,
  PUBLISH_STATUS_LABELS,
  type AdminNoteListItem,
  type LinkType,
  type MetadataItemInput,
  type MetadataKind,
  type Progress,
  type PublishStatus,
  type Screenshot,
  type ScreenshotInput,
} from '@/types'
import {
  METRIC_KEY_LABEL_MAX,
  METRIC_MAX,
  METRIC_VALUE_MAX,
  META_KEY_LABEL_MAX,
  META_VALUE_MAX,
  SCREENSHOT_CAPTION_MAX,
  SCREENSHOT_MAX,
  SCREENSHOT_URL_MAX,
} from '@/constants/limits'

/**
 * 项目编辑器：固定列 + 自定义元数据（KV）+ 链接。
 * 三块独立保存（元数据 PATCH / KV PUT / 链接逐条）。
 * 笔记改为独立栏目（N:1），编辑器在后续批次交付，这里只做只读清单。
 */
const props = defineProps<{ id?: string }>()

const router = useRouter()

const isNew = computed(() => !props.id)
const projectId = computed(() => props.id ?? '')

const meta = reactive({
  slug: '',
  name: '',
  summary: '',
  description_md: '',
  publish_status: 'draft' as PublishStatus,
  progress: 'ongoing' as Progress,
  stars: null as number | null,
  version: '',
  role: '',
  license: '',
  start_year: null as number | null,
  team_size: null as number | null,
  last_updated_at: '',
  cover_image_url: '',
  cover_source_url: '',
})
const techInput = ref('')

const kvRows = ref<MetadataItemInput[]>([])
const shotRows = ref<ScreenshotInput[]>([])
const shotSaving = ref(false)

const METADATA_KIND_OPTIONS: Array<{ value: MetadataKind; label: string }> = [
  { value: 'meta', label: '元数据行' },
  { value: 'metric', label: '指标卡' },
]

/** 已占用的指标格数量（指标卡 ≤2 条，到上限就该在界面上挡，而不是等后端 400）。 */
const metricCount = computed(() => kvRows.value.filter((row) => row.kind === 'metric').length)
const metricFull = computed(() => metricCount.value >= METRIC_MAX)

/** 该行是否已达指标卡的长度上限（切换成 metric 后键值都要更短）。 */
function kvKeyMax(row: MetadataItemInput): number {
  return row.kind === 'metric' ? METRIC_KEY_LABEL_MAX : META_KEY_LABEL_MAX
}

function kvValueMax(row: MetadataItemInput): number {
  return row.kind === 'metric' ? METRIC_VALUE_MAX : META_VALUE_MAX
}

interface LinkRow {
  id?: string
  type: LinkType
  label: string
  url: string
  sort: number
}
const links = ref<LinkRow[]>([])

const notes = ref<AdminNoteListItem[]>([])

const loading = ref(false)
const error = ref('')
const metaSaving = ref(false)
const metaSaved = ref(false)
const kvSaving = ref(false)
const linkSaving = ref(false)
const notice = ref('')
/** B2：两个大分区默认折叠，页面上先看到「截图 / 链接 / 笔记」，元数据按需展开。 */
const openMeta = ref(false)
const openKv = ref(false)
/** 超过建议字数时计数变色（只是提示，不拦提交）。 */
const summaryNearLimit = computed(() => meta.summary.length > 60)

const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/

function parseTech(input: string): string[] {
  return [...new Set(input.split(/[,，]/).map((s) => s.trim()).filter(Boolean))]
}

/** `<input type="date">` 只认 YYYY-MM-DD；后端可能返回完整 ISO。 */
function dateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

/** YYYY-MM-DD → ISO（UTC 零点），空值表示清空。 */
function isoFromDate(value: string): string | null {
  return value ? `${value}T00:00:00.000Z` : null
}

async function load() {
  if (!props.id) return
  loading.value = true
  error.value = ''
  try {
    const d = await getAdminProject(props.id)
    meta.slug = d.slug
    meta.name = d.name
    meta.summary = d.summary ?? ''
    meta.description_md = d.description_md ?? ''
    meta.publish_status = d.publish_status
    meta.progress = d.progress
    meta.stars = d.stars
    meta.version = d.version ?? ''
    meta.role = d.role ?? ''
    meta.license = d.license ?? ''
    meta.start_year = d.start_year
    meta.team_size = d.team_size
    meta.last_updated_at = dateInput(d.last_updated_at)
    meta.cover_image_url = d.cover_image_url ?? ''
    meta.cover_source_url = d.cover_source_url ?? ''
    techInput.value = d.tech_stack.join(', ')
    kvRows.value = d.metadata.map((row) => ({
      key_label: row.key_label,
      value: row.value,
      kind: row.kind,
    }))
    shotRows.value = d.screenshots.map((shot) => ({
      url: shot.url,
      caption: shot.caption ?? '',
      sort: shot.sort,
    }))
    links.value = d.links.map((l) => ({
      id: l.id,
      type: l.type,
      label: l.label ?? '',
      url: l.url,
      sort: l.sort,
    }))
    const noteRes = await listAdminNotes({ project_id: props.id, pageSize: 100 })
    notes.value = noteRes.items
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function saveMeta() {
  const name = meta.name.trim()
  const slug = meta.slug.trim()
  if (!SLUG_PATTERN.test(slug)) {
    error.value = 'slug 只能包含小写字母、数字与连字符，长度 2–64'
    return
  }
  if (!name) {
    error.value = '项目名称必填'
    return
  }
  if (meta.summary.length > 60) {
    error.value = '一句话简介最长 60 字'
    return
  }
  metaSaving.value = true
  metaSaved.value = false
  error.value = ''
  const payload = {
    slug,
    name,
    summary: meta.summary || null,
    description_md: meta.description_md || null,
    publish_status: meta.publish_status,
    progress: meta.progress,
    stars: meta.stars,
    version: meta.version || null,
    role: meta.role || null,
    license: meta.license || null,
    start_year: meta.start_year,
    team_size: meta.team_size,
    last_updated_at: isoFromDate(meta.last_updated_at),
    cover_image_url: meta.cover_image_url || null,
    cover_source_url: meta.cover_source_url || null,
    tech_stack: parseTech(techInput.value),
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

// ---------- 自定义元数据 ----------
function addKvRow() {
  kvRows.value.push({ key_label: '', value: '', kind: 'meta' })
}

function addMetricRow() {
  if (metricFull.value) return
  kvRows.value.push({ key_label: '', value: '', kind: 'metric' })
}

function removeKvRow(index: number) {
  kvRows.value.splice(index, 1)
}

async function saveMetadata() {
  const rows = kvRows.value
    .map((row) => ({
      key_label: row.key_label.trim(),
      value: row.value,
      ...(row.kind === 'metric' ? { kind: 'metric' as const } : {}),
    }))
    .filter((row) => row.key_label)
  const labels = rows.map((row) => row.key_label)
  if (new Set(labels).size !== labels.length) {
    error.value = '自定义元数据的键名不能重复'
    return
  }
  kvSaving.value = true
  error.value = ''
  try {
    const detail = await replaceProjectMetadata(projectId.value, rows)
    kvRows.value = detail.metadata.map((row) => ({
      key_label: row.key_label,
      value: row.value,
      kind: row.kind,
    }))
    notice.value = '自定义元数据已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    kvSaving.value = false
  }
}

// ---------- 截图 ----------
function addShotRow() {
  if (shotRows.value.length >= SCREENSHOT_MAX) return
  shotRows.value.push({ url: '', caption: '', sort: shotRows.value.length })
}

function removeShotRow(index: number) {
  shotRows.value.splice(index, 1)
}

/** 上下移动 = 改 `sort`（整体替换，数组顺序即顺序）。 */
function moveShot(index: number, delta: number) {
  const next = index + delta
  if (next < 0 || next >= shotRows.value.length) return
  const rows = shotRows.value
  const [row] = rows.splice(index, 1)
  rows.splice(next, 0, row)
  rows.forEach((item, i) => {
    item.sort = i
  })
}

async function saveScreenshots() {
  const rows = shotRows.value
    .map((row, index) => ({
      url: row.url.trim(),
      caption: row.caption?.trim() ? row.caption.trim() : null,
      sort: index,
    }))
    .filter((row) => row.url)
  shotSaving.value = true
  error.value = ''
  try {
    const detail = await replaceProjectScreenshots(projectId.value, rows)
    shotRows.value = detail.screenshots.map((shot: Screenshot) => ({
      url: shot.url,
      caption: shot.caption ?? '',
      sort: shot.sort,
    }))
    notice.value = '截图已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    shotSaving.value = false
  }
}

// ---------- 链接 ----------
function addLinkRow() {
  links.value.push({ type: 'other', label: '', url: '', sort: links.value.length })
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
      sort: index,
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

const statusOptions = Object.entries(PUBLISH_STATUS_LABELS) as Array<[PublishStatus, string]>
const progressOptions = Object.entries(PROGRESS_LABELS) as Array<[Progress, string]>
const linkTypeOptions = Object.entries(LINK_TYPE_LABELS) as Array<[LinkType, string]>

onMounted(() => void load())
</script>

<template>
  <section class="editor">
    <header class="editor-header">
      <div>
        <h1>{{ isNew ? '新建项目' : `编辑：${meta.name || '…'}` }}</h1>
        <p class="subtitle">元数据、自定义字段、链接分区独立保存。</p>
      </div>
      <RouterLink class="btn" :to="{ name: 'admin-projects' }">返回列表</RouterLink>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <div v-else class="sections">
      <!-- 元数据：默认折叠（B2），标题右侧是开关 -->
      <section class="card section" aria-labelledby="meta-title">
        <div class="section-head">
          <h2 id="meta-title">元数据</h2>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :aria-expanded="openMeta"
            aria-controls="meta-body"
            @click="openMeta = !openMeta"
          >
            {{ openMeta ? '收起' : '展开' }}
          </button>
        </div>
        <div v-show="openMeta" id="meta-body" class="meta-body">
          <div class="grid">
          <div class="field">
            <label class="field-label" for="name">名称 *</label>
            <input id="name" v-model="meta.name" class="input" type="text" placeholder="项目名称（≤100 字）" />
          </div>
          <div class="field">
            <label class="field-label" for="slug">slug *</label>
            <input
              id="slug"
              v-model="meta.slug"
              class="input"
              type="text"
              placeholder="小写字母/数字/连字符，如 portfolio"
            />
          </div>
          <div class="field span-2">
            <label class="field-label" for="summary">一句话简介</label>
            <input
              id="summary"
              v-model="meta.summary"
              class="input"
              type="text"
              maxlength="60"
              placeholder="卡片副标题"
              aria-describedby="summary-hint"
            />
            <p id="summary-hint" class="field-hint">
              <span>建议 40–60 字，列表只显示 2 行，超出截断</span>
              <span class="type-mono counter" :class="{ 'counter--over': summaryNearLimit }"
                >{{ meta.summary.length }}/60</span
              >
            </p>
          </div>
          <div class="field span-2">
            <label class="field-label" for="description_md">描述（Markdown）</label>
            <textarea id="description_md" v-model="meta.description_md" class="textarea" rows="6" placeholder="项目描述，支持 Markdown" />
          </div>
          <div class="field">
            <label class="field-label" for="publish_status">曝光状态</label>
            <select id="publish_status" v-model="meta.publish_status" class="select">
              <option v-for="[value, label] in statusOptions" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="progress">进展</label>
            <select id="progress" v-model="meta.progress" class="select">
              <option v-for="[value, label] in progressOptions" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="stars">Star 数</label>
            <input id="stars" v-model.number="meta.stars" class="input" type="number" min="0" step="1" placeholder="手填" />
          </div>
          <div class="field">
            <label class="field-label" for="version">版本</label>
            <input id="version" v-model="meta.version" class="input" type="text" placeholder="如 v1.2.0" />
          </div>
          <div class="field">
            <label class="field-label" for="role">角色</label>
            <input id="role" v-model="meta.role" class="input" type="text" placeholder="如：全栈开发 / 维护者" />
          </div>
          <div class="field">
            <label class="field-label" for="license">许可证</label>
            <input id="license" v-model="meta.license" class="input" type="text" placeholder="如 MIT" />
          </div>
          <div class="field">
            <label class="field-label" for="start_year">开始年份</label>
            <input id="start_year" v-model.number="meta.start_year" class="input" type="number" min="1000" max="9999" step="1" placeholder="如 2023" />
          </div>
          <div class="field">
            <label class="field-label" for="team_size">团队规模</label>
            <input id="team_size" v-model.number="meta.team_size" class="input" type="number" min="1" step="1" placeholder="参与人数" />
          </div>
          <div class="field">
            <label class="field-label" for="last_updated_at">最近更新</label>
            <input id="last_updated_at" v-model="meta.last_updated_at" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="cover_image_url">封面图 URL</label>
            <input id="cover_image_url" v-model="meta.cover_image_url" class="input" type="url" placeholder="https://…（可选，留空用渐层兜底）" />
          </div>
          <div class="field">
            <label class="field-label" for="cover_source_url">封面来源</label>
            <input id="cover_source_url" v-model="meta.cover_source_url" class="input" type="url" placeholder="https://…（可选）" />
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
        </div>
      </section>

      <!-- 自定义元数据（KV）：默认折叠（B2） -->
      <section class="card section" aria-labelledby="kv-title">
        <div class="section-head">
          <h2 id="kv-title">自定义元数据</h2>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :aria-expanded="openKv"
            aria-controls="kv-body"
            @click="openKv = !openKv"
          >
            {{ openKv ? '收起' : '展开' }}
          </button>
        </div>
        <div id="kv-body" v-show="openKv">
        <p v-if="isNew" class="hint">先创建项目，再添加自定义字段。</p>
        <template v-else>
          <p class="hint">
            最多 50 条，键名不可重复；保存时整体替换。「指标卡」条目会渲染成前台详情的数字格，
            最多 {{ METRIC_MAX }} 条（当前 {{ metricCount }}）。
          </p>
          <ul class="kv-list">
            <li v-for="(row, index) in kvRows" :key="index" class="kv-row">
              <select
                v-model="row.kind"
                class="select kv-kind"
                :aria-label="`第 ${index + 1} 条类型`"
              >
                <option v-for="option in METADATA_KIND_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <input v-model="row.key_label" class="input kv-key" type="text" :maxlength="kvKeyMax(row)" placeholder="键名，如 部署平台" :aria-label="`第 ${index + 1} 条键名`" />
              <input v-model="row.value" class="input kv-value" type="text" :maxlength="kvValueMax(row)" placeholder="值" :aria-label="`第 ${index + 1} 条值`" />
              <button class="btn btn-ghost" type="button" @click="removeKvRow(index)">删除</button>
            </li>
          </ul>
          <div class="section-actions">
            <button class="btn" type="button" @click="addKvRow">添加字段</button>
            <button
              class="btn"
              type="button"
              :disabled="metricFull"
              :title="metricFull ? `指标卡最多 ${METRIC_MAX} 条` : undefined"
              @click="addMetricRow"
            >
              {{ metricFull ? `指标卡已满（${METRIC_MAX} 条）` : '添加指标卡' }}
            </button>
            <button class="btn btn-primary" type="button" :disabled="kvSaving" @click="saveMetadata">
              {{ kvSaving ? '保存中…' : '保存自定义字段' }}
            </button>
          </div>
        </template>
        </div>
      </section>

      <!-- 截图（整体替换，顺序即 sort） -->
      <section class="card section" aria-labelledby="shots-title">
        <h2 id="shots-title">截图</h2>
        <p v-if="isNew" class="hint">先创建项目，再添加截图。</p>
        <template v-else>
          <p class="hint">
            最多 {{ SCREENSHOT_MAX }} 张，整体替换；地址必须是 http(s) 绝对地址，图注 ≤{{
              SCREENSHOT_CAPTION_MAX
            }}
            字。保存后前台详情按顺序轮播，零张时整个区块不显示。
          </p>
          <ul class="shot-list">
            <li v-for="(row, index) in shotRows" :key="index" class="shot-row">
              <input
                v-model="row.url"
                class="input shot-url"
                type="url"
                :maxlength="SCREENSHOT_URL_MAX"
                placeholder="https://cdn.example.com/shot.webp"
                :aria-label="`第 ${index + 1} 张截图地址`"
              />
              <input
                v-model="row.caption"
                class="input shot-caption"
                type="text"
                :maxlength="SCREENSHOT_CAPTION_MAX"
                placeholder="图注（可选）"
                :aria-label="`第 ${index + 1} 张图注`"
              />
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                :disabled="index === 0"
                :aria-label="`上移第 ${index + 1} 张`"
                @click="moveShot(index, -1)"
              >
                ↑
              </button>
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                :disabled="index === shotRows.length - 1"
                :aria-label="`下移第 ${index + 1} 张`"
                @click="moveShot(index, 1)"
              >
                ↓
              </button>
              <button class="btn btn-ghost" type="button" @click="removeShotRow(index)">删除</button>
            </li>
          </ul>
          <div class="section-actions">
            <button
              class="btn"
              type="button"
              :disabled="shotRows.length >= SCREENSHOT_MAX"
              :title="shotRows.length >= SCREENSHOT_MAX ? `最多 ${SCREENSHOT_MAX} 张` : undefined"
              @click="addShotRow"
            >
              添加截图
            </button>
            <button class="btn btn-primary" type="button" :disabled="shotSaving" @click="saveScreenshots">
              {{ shotSaving ? '保存中…' : '保存截图' }}
            </button>
          </div>
        </template>
      </section>

      <!-- 链接 -->
      <section class="card section" aria-labelledby="links-title">
        <h2 id="links-title">链接（仓库 / 官网 / 文档 / 演示）</h2>
        <p v-if="isNew" class="hint">先创建项目，再添加链接。</p>
        <ul v-else class="links">
          <li v-for="(row, index) in links" :key="row.id ?? `new-${index}`" class="link-row">
            <select v-model="row.type" class="select link-type" aria-label="链接类型">
              <option v-for="[value, label] in linkTypeOptions" :key="value" :value="value">{{ label }}</option>
            </select>
            <input v-model="row.label" class="input link-label" type="text" maxlength="100" placeholder="名称（可选）" />
            <input v-model="row.url" class="input link-url" type="url" placeholder="https://…" />
            <button class="btn" type="button" :disabled="linkSaving" @click="saveLink(row, index)">保存</button>
            <button class="btn btn-ghost" type="button" :disabled="linkSaving" @click="removeLink(row)">删除</button>
          </li>
        </ul>
        <button v-if="!isNew" class="btn" type="button" :disabled="linkSaving" @click="addLinkRow">添加链接</button>
      </section>

      <!-- 笔记（N:1，独立栏目） -->
      <section class="card section" aria-labelledby="note-title">
        <h2 id="note-title">笔记</h2>
        <p class="hint">
          笔记为独立栏目（与项目 N:1），编辑器在后续批次交付。当前共
          {{ notes.length }} 篇。
        </p>
        <ul v-if="notes.length" class="note-list">
          <li v-for="note in notes" :key="note.id" class="note-item">
            <span class="note-title">{{ note.title }}</span>
            <span class="note-meta">{{ note.publish_status === 'published' ? '已发布' : '草稿' }}</span>
            <!-- 批乙：笔记行带「编辑」入口（03 稿标题区的编辑入口，项目侧先给这条路径） -->
            <RouterLink
              :to="`/admin/notes/${note.id}`"
              class="note-edit"
              :aria-label="`编辑笔记：${note.title}`"
            >
              编辑
            </RouterLink>
          </li>
        </ul>
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
.meta-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.field-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin: 0;
  color: var(--c-text-secondary);
  font-size: 13px;
}
.counter--over {
  color: var(--c-danger);
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
.links,
.kv-list,
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.link-row,
.kv-row {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  align-items: center;
}
.kv-kind {
  width: 120px;
  flex: none;
}
.kv-key {
  width: 200px;
  flex: none;
}
.shot-row {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  align-items: center;
}
.shot-url {
  flex: 1;
  min-width: 240px;
}
.shot-caption {
  width: 260px;
  flex: none;
}
.kv-value {
  flex: 1;
  min-width: 200px;
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
.note-item {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 8px 12px;
  background: var(--c-fill);
  border-radius: var(--r-control);
  font-size: 14px;
}
.note-edit {
  margin-left: auto;
  color: var(--c-primary-strong);
  font-size: 13px;
  min-height: var(--touch-min);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--sp-1);
}
.note-meta {
  color: var(--c-text-secondary);
  font-size: 12px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
  .link-row,
  .kv-row,
  .shot-row {
    flex-direction: column;
    align-items: stretch;
  }
  .link-type,
  .link-label,
  .link-url,
  .kv-key,
  .kv-value,
  .kv-kind,
  .shot-url,
  .shot-caption {
    width: 100%;
  }
}
</style>
