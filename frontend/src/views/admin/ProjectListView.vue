<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteProject, listAdminProjects, restoreProject, updateProject } from '@/api/projects'
import {
  PUBLISH_STATUS_LABELS,
  type AdminProjectListItem,
  type Link,
  type PublishStatus,
} from '@/types'
import { formatDate } from '@/utils/text'
import { safeHttpUrl } from '@/utils/link'
import AppBadge from '@/components/AppBadge.vue'
import ProjectCover from '@/components/ProjectCover.vue'
import ProgressBadge from '@/components/ProgressBadge.vue'
import PublishStatusBadge from '@/components/PublishStatusBadge.vue'
import { useViewportWidth } from '@/composables/useViewportWidth'
import { visibleColumns, type ProjectColumnKey } from './projectColumns'

const router = useRouter()

// 列可见性完全由 projectColumns.ts 的优先级表 + 当前视口宽度决定。
const { width: viewportWidth } = useViewportWidth()
const columns = computed(() => visibleColumns(viewportWidth.value))
const visibleKeys = computed(() => new Set<ProjectColumnKey>(columns.value.map((col) => col.key)))

function isVisible(key: ProjectColumnKey): boolean {
  return visibleKeys.value.has(key)
}

const items = ref<AdminProjectListItem[]>([])
const counts = ref({ all: 0, draft: 0, published: 0, archived: 0 })
const loading = ref(false)
const error = ref('')
const search = ref('')
/** 分段：全部 / 草稿 / 已发布 / 已归档（无「已删除」，软删项目在「全部」里带徽标）。
 *  顺序按研发负责人本轮派单口径（全部/草稿/已发布/已归档），与效果图若有出入以效果图为准。 */
const segment = ref<PublishStatus | ''>('')

const SEGMENTS = computed<Array<{ value: PublishStatus | ''; label: string; count: number }>>(() => [
  { value: '', label: '全部', count: counts.value.all },
  { value: 'draft', label: PUBLISH_STATUS_LABELS.draft, count: counts.value.draft },
  { value: 'published', label: PUBLISH_STATUS_LABELS.published, count: counts.value.published },
  { value: 'archived', label: PUBLISH_STATUS_LABELS.archived, count: counts.value.archived },
])

// 行选择（供后续批量操作使用，本轮仅提供选择态）。
const selected = ref<Set<string>>(new Set())
const allSelected = computed(
  () => items.value.length > 0 && items.value.every((item) => selected.value.has(item.id)),
)

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleSelectAll() {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((item) => item.id))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await listAdminProjects({
      includeDeleted: true,
      page: 1,
      pageSize: 100,
      search: search.value || undefined,
      publish_status: segment.value || undefined,
    })
    items.value = res.items
    counts.value = res.counts
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function pickSegment(value: PublishStatus | '') {
  if (segment.value === value) return
  segment.value = value
  void load()
}

async function runAction(fn: () => Promise<unknown>) {
  error.value = ''
  try {
    await fn()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败'
  }
}

function edit(id: string) {
  void router.push({ name: 'admin-project-edit', params: { id } })
}

/** 删除前二次确认（软删除可恢复）。 */
function confirmDelete(item: AdminProjectListItem) {
  if (window.confirm(`确定删除项目「${item.name}」？删除后可恢复。`)) {
    void runAction(() => deleteProject(item.id))
  }
}

function isDeleted(item: AdminProjectListItem): boolean {
  return item.deleted_at != null
}

/** 链接列：仓库 / 官网两个入口，失效（failed）的降级但仍可见。 */
function entryLinks(item: AdminProjectListItem): Link[] {
  return item.links.filter((link) => link.type === 'repo' || link.type === 'site')
}

function linkHref(link: Link): string | null {
  return safeHttpUrl(link.url)
}

function linkLabel(link: Link): string {
  const failed = link.last_status === 'failed'
  const base = link.type === 'repo' ? '仓库' : '官网'
  return failed ? `${base}（检查失败，可能已失效）` : base
}

onMounted(() => void load())
</script>

<template>
  <section class="projects">
    <header class="projects-header">
      <div>
        <h1>项目列表</h1>
        <p class="subtitle">共 {{ counts.all }} 个项目，支持发布、下架、删除与恢复。</p>
      </div>
      <RouterLink class="btn btn-primary" :to="{ name: 'admin-project-new' }">新建项目</RouterLink>
    </header>

    <div class="filters card">
      <form class="filters-search" @submit.prevent="load">
        <label class="field-label" for="search">搜索</label>
        <input
          id="search"
          v-model="search"
          class="input"
          type="search"
          placeholder="按名称、slug 或简介搜索"
        />
      </form>
      <div class="segments" role="group" aria-label="按发布状态筛选">
        <button
          v-for="seg in SEGMENTS"
          :key="seg.value || 'all'"
          class="segment"
          type="button"
          :class="{ 'segment--active': segment === seg.value }"
          :aria-pressed="segment === seg.value"
          :aria-label="`${seg.label} ${seg.count}`"
          @click="pickSegment(seg.value)"
        >
          {{ seg.label }}<span class="segment-count tabular-nums">{{ seg.count }}</span>
        </button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="!items.length" class="hint">暂无项目。</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="col-select">
              <input
                type="checkbox"
                :checked="allSelected"
                aria-label="全选"
                @change="toggleSelectAll"
              />
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="column.className"
              :data-column="column.key"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :class="{ selected: selected.has(item.id) }">
            <td class="col-select">
              <input
                type="checkbox"
                :checked="selected.has(item.id)"
                :aria-label="`选择 ${item.name}`"
                @change="toggleSelect(item.id)"
              />
            </td>
            <td v-if="isVisible('name')" class="col-name">
              <div class="project-cell">
                <div class="thumb">
                  <ProjectCover :name="item.name" :cover-image="item.cover_image_url" variant="thumb" />
                </div>
                <div class="project-text">
                  <!-- 名称即编辑入口：窄屏隐藏操作列后仍能进编辑器 -->
                  <RouterLink
                    class="project-name"
                    :to="{ name: 'admin-project-edit', params: { id: item.id } }"
                  >
                    {{ item.name }}
                  </RouterLink>
                  <div v-if="isDeleted(item)" class="project-sub">
                    <AppBadge tone="danger">已删除</AppBadge>
                  </div>
                </div>
              </div>
            </td>
            <td v-if="isVisible('slug')" class="col-slug">
              <code class="slug">{{ item.slug }}</code>
            </td>
            <td v-if="isVisible('publish_status')" class="col-status">
              <PublishStatusBadge :status="item.publish_status" />
            </td>
            <td v-if="isVisible('progress')" class="col-progress">
              <ProgressBadge :progress="item.progress" />
            </td>
            <td v-if="isVisible('links')" class="col-links">
              <span class="entries">
                <template v-for="link in entryLinks(item)" :key="link.id">
                  <a
                    v-if="linkHref(link)"
                    class="entry"
                    :class="{ 'entry--failed': link.last_status === 'failed' }"
                    :href="linkHref(link) ?? undefined"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="`${linkLabel(link)}（新窗口打开）`"
                    :title="linkLabel(link)"
                  >
                    {{ link.type === 'repo' ? '仓库' : '官网' }}
                    <span v-if="link.last_status === 'failed'" aria-hidden="true">⚠</span>
                  </a>
                  <span v-else class="entry entry--failed" :title="linkLabel(link)">
                    {{ link.type === 'repo' ? '仓库' : '官网' }} ⚠
                  </span>
                </template>
                <span v-if="!entryLinks(item).length" class="muted">—</span>
              </span>
            </td>
            <td v-if="isVisible('updated_at')" class="col-updated">
              <span class="tabular-nums">{{ formatDate(item.updated_at) }}</span>
            </td>
            <td v-if="isVisible('actions')" class="col-actions">
              <div class="actions">
                <button class="btn btn-sm btn-ghost" type="button" @click="edit(item.id)">编辑</button>
                <template v-if="!isDeleted(item)">
                  <button
                    v-if="item.publish_status !== 'published'"
                    class="btn btn-sm"
                    type="button"
                    @click="runAction(() => updateProject(item.id, { publish_status: 'published' }))"
                  >
                    发布
                  </button>
                  <button
                    v-if="item.publish_status === 'published'"
                    class="btn btn-sm"
                    type="button"
                    @click="runAction(() => updateProject(item.id, { publish_status: 'archived' }))"
                  >
                    下架
                  </button>
                  <button class="btn btn-sm btn-danger" type="button" @click="confirmDelete(item)">
                    删除
                  </button>
                </template>
                <button
                  v-else
                  class="btn btn-sm"
                  type="button"
                  @click="runAction(() => restoreProject(item.id))"
                >
                  恢复
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.projects {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.projects-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2);
}
.projects-header h1 {
  margin: 0;
  font-size: 28px;
  color: var(--c-ink);
}
.subtitle {
  margin: var(--sp-1) 0 0;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.filters {
  display: flex;
  align-items: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2);
  flex-wrap: wrap;
}
.filters-search {
  flex: 1;
  min-width: 220px;
}
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.segments {
  display: inline-flex;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.segment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--touch-min);
  padding: 0 12px;
  font-size: 13px;
  color: var(--c-text);
  background: transparent;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.segment:hover {
  background: var(--c-surface);
}
.segment--active {
  color: var(--c-primary-strong);
  background: var(--c-surface);
  box-shadow: var(--shadow-e1);
  font-weight: 600;
}
.segment-count {
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}
.error {
  margin: 0;
  padding: 8px 12px;
  color: var(--c-danger);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.hint {
  margin: 0;
  color: var(--c-text-secondary);
}

.table-wrap {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-e1);
  overflow-x: auto;
}
.table {
  width: 100%;
  min-width: var(--admin-min-width);
  border-collapse: collapse;
  font-size: 14px;
}
.table th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 44px;
  padding: 0 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-secondary);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
}
.table td {
  padding: 8px 16px;
  border-bottom: 1px solid #e0dbd8;
  vertical-align: middle;
}
.table tbody tr:last-child td {
  border-bottom: none;
}
.table tbody tr:hover {
  background: #f1efec;
}
.table tbody tr.selected {
  background: var(--c-primary-soft);
  box-shadow: inset 2px 0 0 var(--c-primary);
}

/* 列宽：7 数据列 + 工具列 */
.col-select {
  width: 48px;
  text-align: center;
}
.col-name {
  min-width: 240px;
}
.col-slug {
  width: 168px;
}
.col-status {
  width: 108px;
}
.col-progress {
  width: 108px;
}
.col-links {
  width: 148px;
}
.col-updated {
  width: 132px;
  white-space: nowrap;
}
.col-actions {
  text-align: right;
  white-space: nowrap;
}

/* 复选框：18×18 r4，热区 ≥ 40px */
.table input[type='checkbox'] {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--c-primary);
}

/* 名称列 */
.project-cell {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.thumb {
  flex: none;
  width: 44px;
  height: 44px;
}
.project-text {
  min-width: 0;
}
.project-name {
  display: block;
  font-weight: 700;
  color: var(--c-ink);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-name:hover {
  color: var(--c-primary-strong);
  text-decoration: underline;
}
.project-sub {
  margin-top: 2px;
}

.slug {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}

.entries {
  display: inline-flex;
  gap: var(--space-12);
}
.entry {
  font-size: 13px;
  color: var(--c-primary-strong);
  text-decoration: none;
  white-space: nowrap;
  border-radius: var(--r-tag);
}
.entry:hover {
  text-decoration: underline;
}
/* F9：只有「检查失败」才降级；unknown / ok 与正常入口同款 */
.entry--failed {
  color: var(--c-text-secondary);
  text-decoration: line-through dotted;
}
.muted {
  color: var(--c-text-secondary);
}

.actions {
  display: inline-flex;
  gap: var(--sp-1);
  justify-content: flex-end;
}
.btn-sm {
  min-height: 44px; /* 热区 ≥ 44px */
  padding: 6px 10px;
  font-size: 13px;
}

/* 隐列不再写 media query：可见性来自 projectColumns.ts 的优先级表（minWidth），
   从右往左依次隐藏（操作 → 更新时间 → 进展 → slug），名称/发布状态/链接恒显。 */
</style>
