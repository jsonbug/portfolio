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
import { formatShortDate } from '@/utils/text'
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

/** 隐藏的列降级到别处（D5 稿）：更新时间 / slug 进名称下方小字，进展并入发布状态单元格。 */
const slugAsSubline = computed(() => !isVisible('slug'))
const updatedAsSubline = computed(() => !isVisible('updated_at'))
const progressInStatusCell = computed(() => !isVisible('progress'))

/**
 * 名称下方的小字：笔记数恒显示，slug / 更新时间只在对应列被隐藏时才并进来。
 * 三者合并成一行（`·` 分隔），窄屏不会堆成三行。
 */
function subline(item: AdminProjectListItem): string {
  const parts: string[] = []
  if (slugAsSubline.value) parts.push(`/projects/${item.slug}`)
  parts.push(`笔记 ${item.note_count}`)
  if (updatedAsSubline.value) parts.push(`更新 ${formatShortDate(item.updated_at)}`)
  return parts.join(' · ')
}

const PAGE_SIZE = 20

const items = ref<AdminProjectListItem[]>([])
const counts = ref({ all: 0, draft: 0, published: 0, archived: 0 })
const total = ref(0)
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const loading = ref(false)
const error = ref('')
/** 批量操作的结论文案（成功也要说话，否则用户不知道跳过的那些为什么没变）。 */
const batchNotice = ref('')
const search = ref('')
/** 分段：全部 / 已发布 / 草稿 / 已归档（无「已删除」，软删项目在「全部」里带徽标）。 */
const segment = ref<PublishStatus | ''>('')

const SEGMENTS = computed<Array<{ value: PublishStatus | ''; label: string; count: number }>>(() => [
  { value: '', label: '全部', count: counts.value.all },
  { value: 'published', label: PUBLISH_STATUS_LABELS.published, count: counts.value.published },
  { value: 'draft', label: PUBLISH_STATUS_LABELS.draft, count: counts.value.draft },
  { value: 'archived', label: PUBLISH_STATUS_LABELS.archived, count: counts.value.archived },
])

// 行选择：批量归档用。
const selected = ref<Set<string>>(new Set())
const allSelected = computed(
  () => items.value.length > 0 && items.value.every((item) => selected.value.has(item.id)),
)
const selectedCount = computed(() => selected.value.size)

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleSelectAll() {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((item) => item.id))
}

/**
 * 拉当前页。
 *
 * `allowFallback` 只对**自动回落**再放行一次：末页被删空（或手改 URL 到越界页）时，
 * 把页码拉回 `totalPages` 再取一次，避免出现「page=6、列表空、却没有分页控件」的不一致；
 * 回落一次仍空就照常显示空态，不做第二次递归。
 */
async function load(allowFallback = true): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await listAdminProjects({
      includeDeleted: true,
      page: page.value,
      pageSize: PAGE_SIZE,
      search: search.value || undefined,
      publish_status: segment.value || undefined,
    })
    items.value = res.items
    counts.value = res.counts
    total.value = res.total

    if (allowFallback && res.items.length === 0 && page.value > 1) {
      const fallback = Math.max(1, totalPages.value)
      if (fallback !== page.value) {
        page.value = fallback
        await load(false)
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 分段切换。
 *
 * 同值点击**不是**空操作：它是「重新看第一页」的手势（在第 3 页点当前分段 = 回第 1 页），
 * 也是手动刷新入口。早退会让这两件事都失效。
 */
function pickSegment(value: PublishStatus | '') {
  segment.value = value
  page.value = 1
  void load()
}

function submitSearch() {
  page.value = 1
  void load()
}

function gotoPage(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
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

/**
 * 批量归档：逐个 PATCH（契约无批量端点），**逐条累计**成败，不因一条失败就丢弃前面已成功的。
 *
 * 已归档项跳过以省请求——不是「已归档不能再归档」：后端对 `archived → archived` 返 200 幂等，
 * 跳过只是让 N 次点击不发出 N 个无意义的 PATCH。
 */
async function archiveSelected() {
  if (!selectedCount.value) return
  if (!window.confirm(`确定归档选中的 ${selectedCount.value} 个项目？归档后前台不可见。`)) return
  error.value = ''
  batchNotice.value = ''

  const targets = items.value.filter((item) => selected.value.has(item.id))
  const skipped = targets.filter((item) => item.publish_status === 'archived')
  const toArchive = targets.filter((item) => item.publish_status !== 'archived')

  const failed: AdminProjectListItem[] = []
  let archived = 0
  for (const item of toArchive) {
    try {
      await updateProject(item.id, { publish_status: 'archived' })
      archived += 1
    } catch {
      // 单条失败不中断：把失败的挑出来一次性告知，成功的照常计数
      failed.push(item)
    }
  }

  // 成功归档的行从选择里摘掉；失败与跳过的保留，用户可以只对它们重试
  const nextSelected = new Set(selected.value)
  for (const item of toArchive) {
    if (!failed.includes(item)) nextSelected.delete(item.id)
  }
  selected.value = nextSelected

  batchNotice.value = archiveNotice(archived, failed, skipped)
  // 失败不写进 `error`：`load()` 开头会清 error，批次结论统一放 batchNotice，
  // 用户点一次「批量归档」只该看到一条结论，而不是两条措辞不同的消息。
  await load()
}

/** 批量归档的结果文案（全成功 / 有失败 / 有跳过）。 */
function archiveNotice(
  archived: number,
  failed: AdminProjectListItem[],
  skipped: AdminProjectListItem[],
): string {
  const parts: string[] = []
  if (failed.length) {
    parts.push(`已归档 ${archived} 条，失败 ${failed.length} 条：${failed.map((item) => item.name).join('、')}`)
  } else {
    parts.push(`已归档 ${archived} 条`)
  }
  if (skipped.length) parts.push(`（已跳过 ${skipped.length} 条已归档项）`)
  return parts.join('')
}

/** 导出当前列表为 JSON（前端导出，无后端端点）。 */
function exportJson() {
  const payload = {
    exported_at: new Date().toISOString(),
    total: total.value,
    items: items.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `projects-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
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

/** 行尾 ⋯ 菜单（操作列隐藏时仍可编辑，窄屏只剩「编辑」文字链接）。 */
const openMenuId = ref<string | null>(null)

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
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
    <nav class="crumbs" aria-label="面包屑">
      <span>后台</span>
      <span aria-hidden="true">/</span>
      <span aria-current="page">项目</span>
    </nav>

    <header class="projects-header">
      <div>
        <h1>项目管理</h1>
        <p class="subtitle">
          分段的维度是「发布状态」，与「进展」正交。归档项目保留数据但前台不可见。
        </p>
      </div>
      <div class="header-actions">
        <button class="btn" type="button" @click="exportJson">导出 JSON</button>
        <RouterLink class="btn btn-primary" :to="{ name: 'admin-project-new' }">
          + 新建项目
        </RouterLink>
      </div>
    </header>

    <div class="filters card">
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

      <div class="filters-right">
        <form class="filters-search" @submit.prevent="submitSearch">
          <label class="sr-only" for="search">搜索名称 / slug</label>
          <input
            id="search"
            v-model="search"
            class="input"
            type="search"
            placeholder="搜索名称 / slug"
          />
        </form>
        <span class="selection tabular-nums">已选 {{ selectedCount }} 项</span>
        <button
          class="btn"
          type="button"
          :disabled="selectedCount === 0"
          @click="archiveSelected"
        >
          批量归档
        </button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="batchNotice" class="batch-notice" role="status">{{ batchNotice }}</p>
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="!items.length" class="hint">暂无项目。</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col" class="col-select">
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
              scope="col"
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
                  <ProjectCover
                    :name="item.name"
                    :cover-image="item.cover_image_url"
                    variant="thumb"
                  />
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
                  <div class="project-sub" :class="{ mono: slugAsSubline }">{{ subline(item) }}</div>
                </div>
              </div>
            </td>
            <td v-if="isVisible('slug')" class="col-slug">
              <code class="slug">/projects/{{ item.slug }}</code>
            </td>
            <td v-if="isVisible('publish_status')" class="col-status">
              <div class="status-stack">
                <PublishStatusBadge :status="item.publish_status" />
                <ProgressBadge v-if="progressInStatusCell" :progress="item.progress" />
              </div>
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
              <span class="tabular-nums">{{ formatShortDate(item.updated_at) }}</span>
            </td>
            <td v-if="isVisible('actions')" class="col-actions">
              <div class="actions">
                <button class="link-btn" type="button" @click="edit(item.id)">编辑</button>
                <div class="menu-wrap">
                  <button
                    class="link-btn menu-trigger"
                    type="button"
                    :aria-expanded="openMenuId === item.id"
                    :aria-label="`更多操作：${item.name}`"
                    @click="toggleMenu(item.id)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenuId === item.id" class="menu" role="menu">
                    <template v-if="!isDeleted(item)">
                      <button
                        v-if="item.publish_status !== 'published'"
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="openMenuId = null; runAction(() => updateProject(item.id, { publish_status: 'published' }))"
                      >
                        发布
                      </button>
                      <button
                        v-if="item.publish_status === 'published'"
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="openMenuId = null; runAction(() => updateProject(item.id, { publish_status: 'archived' }))"
                      >
                        归档
                      </button>
                      <button
                        class="menu-item menu-item--danger"
                        role="menuitem"
                        type="button"
                        @click="openMenuId = null; confirmDelete(item)"
                      >
                        删除
                      </button>
                    </template>
                    <button
                      v-else
                      class="menu-item"
                      role="menuitem"
                      type="button"
                      @click="openMenuId = null; runAction(() => restoreProject(item.id))"
                    >
                      恢复
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="table-footer">
        <span class="footer-text tabular-nums">
          共 {{ total }} 个项目 · 每页 {{ PAGE_SIZE }} 条 · 前台仅「已发布」可见
        </span>
        <nav class="pager" aria-label="分页">
          <button
            v-for="p in totalPages"
            :key="p"
            class="pager-btn"
            type="button"
            :class="{ 'pager-btn--active': p === page }"
            :aria-label="`第 ${p} 页，共 ${totalPages} 页`"
            :aria-current="p === page ? 'page' : undefined"
            @click="gotoPage(p)"
          >
            {{ p }}
          </button>
        </nav>
      </footer>
    </div>

    <section class="visibility card" aria-labelledby="visibility-title">
      <h2 id="visibility-title" class="visibility-title">可见性口径（与前台一致）</h2>
      <dl class="visibility-grid">
        <div class="visibility-cell">
          <dt><PublishStatusBadge status="published" /></dt>
          <dd>前台可见；未删除即参与列表与详情。</dd>
        </div>
        <div class="visibility-cell">
          <dt><PublishStatusBadge status="draft" /></dt>
          <dd>前台不可见；改名不留旧 slug。</dd>
        </div>
        <div class="visibility-cell">
          <dt><PublishStatusBadge status="archived" /></dt>
          <dd>前台不可见；数据与笔记保留，旧链接仍 301。</dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.projects {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.crumbs {
  display: flex;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.projects-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.projects-header h1 {
  margin: 0;
  font-size: 28px;
  color: var(--c-ink);
}
.subtitle {
  margin: var(--sp-1) 0 0;
  max-width: 52em;
  font-size: 13px;
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}
.header-actions {
  display: flex;
  gap: var(--sp-1);
}

.filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-1);
  flex-wrap: wrap;
}
.filters-right {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex: 1;
  justify-content: flex-end;
  min-width: 320px;
}
.filters-search {
  flex: 1;
  max-width: 320px;
}
.filters-search .input {
  width: 100%;
  height: var(--control-h);
}
.selection {
  font-size: 13px;
  color: var(--c-text-secondary);
  white-space: nowrap;
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
.batch-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: var(--fs-small);
  color: var(--c-success);
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
  width: 176px;
}
.col-status {
  width: 140px;
}
.col-progress {
  width: 108px;
}
.col-links {
  width: 148px;
}
.col-updated {
  width: 108px;
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
  font-size: var(--fs-small);
  color: var(--c-text-secondary);
}
.project-sub.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-mono);
}

.slug {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}

.status-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
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

/* 操作列：文字链接（效果图 04），不是按钮 */
.actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-12);
  justify-content: flex-end;
}
.link-btn {
  padding: 6px 4px;
  min-height: 32px;
  font-size: 13px;
  color: var(--c-primary-strong);
  background: none;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.menu-wrap {
  position: relative;
  display: inline-flex;
}
.menu-trigger {
  color: var(--c-text-secondary);
  font-size: 16px;
  line-height: 1;
}
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 2;
  min-width: 116px;
  padding: var(--space-4);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-control);
  box-shadow: var(--shadow-e2);
  display: flex;
  flex-direction: column;
}
.menu-item {
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--c-text);
  background: none;
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.menu-item:hover {
  background: var(--c-fill);
}
.menu-item--danger {
  color: var(--c-danger);
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border-top: 1px solid var(--c-border);
}
.footer-text {
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}
.pager {
  display: inline-flex;
  gap: var(--space-4);
}
.pager-btn {
  min-width: 32px;
  min-height: 32px;
  font-size: var(--fs-mono);
  color: var(--c-text);
  background: var(--c-fill);
  border: none;
  border-radius: var(--r-tag);
  cursor: pointer;
}
.pager-btn--active {
  color: var(--c-surface);
  background: var(--c-ink);
}

.visibility {
  padding: var(--sp-2);
}
.visibility-title {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  color: var(--c-ink);
}
.visibility-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-2);
  margin: 0;
}
.visibility-cell dd {
  margin: 6px 0 0;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}

@media (max-width: 1023px) {
  .visibility-grid {
    grid-template-columns: 1fr;
  }
}
</style>
