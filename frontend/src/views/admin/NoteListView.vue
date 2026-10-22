<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { listAdminNotes } from '@/api/notes'
import { useAdminPagination } from '@/composables/useAdminPagination'
import { PUBLISH_STATUS_LABELS, type AdminNoteListItem, type NotePublishStatus } from '@/types'
import { formatShortDate } from '@/utils/text'
import { groupNotesByProject } from '@/utils/notes'
import PublishStatusBadge from '@/components/PublishStatusBadge.vue'

/**
 * 后台笔记列表（03 稿）：跨项目看全部笔记。
 *
 * 之前笔记只能从项目编辑器的笔记区进去，跨项目找一篇要么翻项目、要么记得 slug；
 * `GET /admin/notes` 本来就能按 `project_id` / `publish_status` / `search` 过滤，缺的只是这个宿主。
 */
const search = ref('')
const projectId = ref('')
const status = ref<NotePublishStatus | ''>('')

/**
 * 项目筛选的选项与计数。
 *
 * 计数复用前台笔记树那套分组逻辑（`utils/notes`），不另写一遍：两处口径不同时，
 * 用户会在后台看到「项目展示平台 3」、到前台树上看到「项目展示平台 · 4」。
 */
const allNotes = ref<AdminNoteListItem[]>([])
// 后台按 `project_id` 过滤接口参数，分组键就用 project_id（前台树按 slug）。
const groups = computed(() => groupNotesByProject(allNotes.value, (note) => note.project_id))

const SEGMENTS = computed<Array<{ value: NotePublishStatus | ''; label: string }>>(() => [
  { value: '', label: '全部' },
  { value: 'published', label: PUBLISH_STATUS_LABELS.published },
  { value: 'draft', label: PUBLISH_STATUS_LABELS.draft },
])

const hasFilters = computed(() => Boolean(search.value || projectId.value || status.value))

/** 分页与「末页删空回落」和后台项目列表共用同一份实现（`useAdminPagination`）。 */
const { items, total, page, totalPages, loading, error, pageSize: PAGE_SIZE, load, gotoPage, resetToFirstPage } =
  useAdminPagination<AdminNoteListItem>((nextPage, size) =>
    listAdminNotes({
      page: nextPage,
      pageSize: size,
      search: search.value || undefined,
      project_id: projectId.value || undefined,
      publish_status: status.value || undefined,
    }),
  )

/** 项目下拉的计数只需要一次全量取（契约单页上限 100），筛选本身仍走服务端。 */
async function loadGroups(): Promise<void> {
  try {
    const res = await listAdminNotes({ page: 1, pageSize: 100 })
    allNotes.value = res.items
  } catch {
    allNotes.value = []
  }
}

onMounted(() => {
  void load()
  void loadGroups()
})

function submitSearch(): void {
  resetToFirstPage()
  void load()
}

function pickStatus(value: NotePublishStatus | ''): void {
  status.value = value
  resetToFirstPage()
  void load()
}

function pickProject(event: Event): void {
  projectId.value = (event.target as HTMLSelectElement).value
  resetToFirstPage()
  void load()
}

function clearFilters(): void {
  search.value = ''
  projectId.value = ''
  status.value = ''
  resetToFirstPage()
  void load()
}
</script>

<template>
  <section class="notes">
    <header class="head">
      <nav class="crumbs" aria-label="面包屑">
        <span>后台</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">笔记</span>
      </nav>
      <div class="title-row">
        <h1 class="title">笔记</h1>
        <RouterLink :to="{ name: 'admin-note-new' }" class="btn btn-primary">+ 新建笔记</RouterLink>
      </div>
      <p class="subtitle type-small">跨项目查看全部笔记；草稿只在后台可见。</p>
    </header>

    <div class="filters card">
      <nav class="segments" aria-label="笔记状态分段">
        <button
          v-for="segment in SEGMENTS"
          :key="segment.value || 'all'"
          type="button"
          class="segment"
          :class="{ 'segment--active': status === segment.value }"
          :aria-pressed="status === segment.value"
          @click="pickStatus(segment.value)"
        >
          {{ segment.label }}
        </button>
      </nav>

      <form class="search" role="search" @submit.prevent="submitSearch">
        <input
          v-model="search"
          class="input"
          type="search"
          aria-label="搜索笔记"
          placeholder="搜索标题 / 正文"
        />
      </form>

      <label class="project-field">
        <span class="sr-only">按项目筛选</span>
        <select class="select" aria-label="按项目筛选" :value="projectId" @change="pickProject">
          <option value="">全部项目</option>
          <option v-for="group in groups" :key="group.key" :value="group.key">
            {{ group.name }}（{{ group.count }}）
          </option>
        </select>
      </label>

      <button v-if="hasFilters" type="button" class="btn btn-ghost btn-sm" @click="clearFilters">
        清除筛选
      </button>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap card">
      <table class="table">
        <caption class="sr-only">笔记列表</caption>
        <thead>
          <tr>
            <th scope="col">标题</th>
            <th scope="col">所属项目</th>
            <th scope="col">状态</th>
            <th scope="col">更新时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !items.length">
            <td colspan="5" class="hint">加载中…</td>
          </tr>
          <tr v-else-if="!items.length">
            <td colspan="5" class="empty">
              <p class="empty-title">{{ hasFilters ? '没有符合条件的笔记' : '还没有笔记' }}</p>
              <button v-if="hasFilters" type="button" class="btn btn-ghost btn-sm" @click="clearFilters">
                清除筛选
              </button>
              <RouterLink v-else :to="{ name: 'admin-note-new' }" class="btn btn-primary btn-sm">
                写第一篇
              </RouterLink>
            </td>
          </tr>
          <tr v-for="note in items" v-else :key="note.id">
            <td class="cell-title">
              <span class="note-title">{{ note.title }}</span>
              <span class="note-slug type-mono">{{ note.slug }}</span>
            </td>
            <td>{{ note.project.name }}</td>
            <td><PublishStatusBadge :status="note.publish_status" /></td>
            <td class="tabular-nums">{{ formatShortDate(note.updated_at) }}</td>
            <td>
              <RouterLink
                :to="`/admin/notes/${note.id}`"
                class="edit-link"
                :aria-label="`编辑笔记：${note.title}`"
              >
                编辑
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="table-footer">
        <span class="footer-text tabular-nums">共 {{ total }} 篇笔记 · 每页 {{ PAGE_SIZE }} 条</span>
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
  </section>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
  padding: var(--space-32);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.crumbs {
  display: flex;
  gap: var(--space-8);
  color: var(--c-text-secondary);
  font-size: var(--fs-small);
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
}
.title {
  margin: 0;
  font-size: var(--fs-h1);
  line-height: var(--lh-h1);
}
.subtitle {
  margin: 0;
  color: var(--c-text-secondary);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-12);
}
.search {
  flex: 1 1 220px;
  min-width: 160px;
}
.search .input {
  width: 100%;
}
.project-field {
  flex: none;
}
.table-wrap {
  overflow-x: auto;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-small);
}
.table th,
.table td {
  padding: var(--space-12) var(--space-16);
  text-align: left;
  border-bottom: 1px solid var(--c-border);
  vertical-align: middle;
}
.table thead th {
  color: var(--c-text-secondary);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}
.cell-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.note-title {
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
}
.note-slug {
  color: var(--c-text-secondary);
}
.edit-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-min);
  color: var(--c-primary-strong);
}
.hint,
.empty {
  text-align: center;
  color: var(--c-text-secondary);
}
.empty {
  padding: var(--space-32);
}
.empty-title {
  margin: 0 0 var(--space-12);
  color: var(--c-text);
}
.table-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-16);
}
.footer-text {
  color: var(--c-text-secondary);
  font-size: var(--fs-small);
}
</style>
