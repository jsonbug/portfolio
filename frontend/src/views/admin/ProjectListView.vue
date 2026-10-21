<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteProject, listAdminProjects, restoreProject, updateProject } from '@/api/projects'
import { PROJECT_STATUS_LABELS, type AdminProjectListItem, type ProjectStatus } from '@/types'
import { formatDate } from '@/utils/text'
import AppBadge from '@/components/AppBadge.vue'
import ProjectCover from '@/components/ProjectCover.vue'
import StatusBadge from '@/components/StatusBadge.vue'

const router = useRouter()

const items = ref<AdminProjectListItem[]>([])
const loading = ref(false)
const error = ref('')
const total = ref(0)

const filters = reactive({ search: '', status: '' })

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

/** 技术栈折叠摘要：前两项 + 剩余计数（隐藏技术栈列时展示）。 */
function techTail(item: AdminProjectListItem): string {
  if (item.technologies.length <= 2) return item.technologies.join(' ')
  return `${item.technologies.slice(0, 2).join(' ')} +${item.technologies.length - 2}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await listAdminProjects({
      includeDeleted: true,
      page: 1,
      pageSize: 100,
      search: filters.search || undefined,
      status: filters.status || undefined,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
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
  return item.deletedAt != null
}

const statusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'draft', label: PROJECT_STATUS_LABELS.draft },
  { value: 'published', label: PROJECT_STATUS_LABELS.published },
  { value: 'archived', label: PROJECT_STATUS_LABELS.archived },
]

onMounted(() => void load())
</script>

<template>
  <section class="projects">
    <header class="projects-header">
      <div>
        <h1>项目列表</h1>
        <p class="subtitle">共 {{ total }} 个项目，支持发布、下架、删除与恢复。</p>
      </div>
      <RouterLink class="btn btn-primary" :to="{ name: 'admin-project-new' }">新建项目</RouterLink>
    </header>

    <form class="filters card" @submit.prevent="load">
      <div class="field filters-search">
        <label class="field-label" for="search">搜索</label>
        <input
          id="search"
          v-model="filters.search"
          class="input"
          type="search"
          placeholder="按名称或简介搜索"
        />
      </div>
      <div class="field">
        <label class="field-label" for="status">状态</label>
        <select id="status" v-model="filters.status" class="select">
          <option value="">全部</option>
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <button class="btn" type="submit">筛选</button>
    </form>

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
            <th class="col-project">项目</th>
            <th class="col-status">状态</th>
            <th class="col-updated">更新时间</th>
            <th class="col-tech">技术栈</th>
            <th class="col-actions">操作</th>
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
            <td class="col-project">
              <div class="project-cell">
                <div class="thumb">
                  <ProjectCover :name="item.name" :cover-image="item.coverImage" variant="thumb" />
                </div>
                <div class="project-text">
                  <div class="project-title">
                    <span class="project-name">{{ item.name }}</span>
                  </div>
                  <div class="project-sub">
                    <span v-if="item.tagline" class="tagline">{{ item.tagline }}</span>
                    <span class="fold-updated">{{ formatDate(item.updatedAt) }}</span>
                    <span class="fold-tech">{{ techTail(item) }}</span>
                  </div>
                </div>
              </div>
            </td>
            <td class="col-status">
              <StatusBadge v-if="!isDeleted(item)" :status="item.status" />
              <AppBadge v-else tone="danger">已删除</AppBadge>
            </td>
            <td class="col-updated">
              <span class="tabular-nums">{{ formatDate(item.updatedAt) }}</span>
            </td>
            <td class="col-tech">
              <span class="tags">
                <span v-for="tech in item.technologies" :key="tech" class="tag">{{ tech }}</span>
              </span>
            </td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn btn-sm btn-ghost" type="button" @click="edit(item.id)">编辑</button>
                <template v-if="!isDeleted(item)">
                  <button
                    v-if="item.status !== 'published'"
                    class="btn btn-sm"
                    type="button"
                    @click="runAction(() => updateProject(item.id, { status: 'published' }))"
                  >
                    发布
                  </button>
                  <button
                    v-if="item.status === 'published'"
                    class="btn btn-sm"
                    type="button"
                    @click="runAction(() => updateProject(item.id, { status: 'archived' }))"
                  >
                    下架
                  </button>
                  <button
                    class="btn btn-sm btn-danger"
                    type="button"
                    @click="confirmDelete(item)"
                  >
                    删除
                  </button>
                </template>
                <button v-else class="btn btn-sm" type="button" @click="runAction(() => restoreProject(item.id))">
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
  min-width: 200px;
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
  overflow: hidden;
}
.table {
  width: 100%;
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

/* 列宽 */
.col-select {
  width: 48px;
}
.col-status {
  width: 104px;
}
.col-updated {
  width: 132px;
  white-space: nowrap;
}
.col-tech {
  width: 190px;
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
.col-select {
  text-align: center;
}

/* 项目列 */
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
.project-title {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.project-name {
  font-weight: 700;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-sub {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: 12px;
  color: var(--c-text-secondary);
  font-variant-numeric: tabular-nums;
}
.tagline {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tag {
  padding: 1px 8px;
  font-size: 12px;
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
  border-radius: var(--r-tag);
  white-space: nowrap;
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

/* 折叠信息：默认隐藏，仅在对应列被隐藏时展示 */
.fold-updated,
.fold-tech {
  display: none;
}

/* 断点 1：≤1279 隐藏「更新时间」列，折进项目列 */
@media (max-width: 1279px) {
  .col-updated {
    display: none;
  }
  .fold-updated {
    display: inline;
  }
}
/* 断点 2：≤1119 再隐藏「技术栈」列，折成尾部摘要 */
@media (max-width: 1119px) {
  .col-tech {
    display: none;
  }
  .fold-tech {
    display: inline;
  }
}
/* 断点 3：<960 卡片化 */
@media (max-width: 959px) {
  .table-wrap {
    border: none;
    box-shadow: none;
    background: transparent;
    overflow: visible;
  }
  .table,
  .table thead,
  .table tbody,
  .table tr,
  .table td {
    display: block;
  }
  .table thead {
    display: none;
  }
  .table tbody tr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin-bottom: 12px;
    padding: 12px 16px;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-e1);
  }
  .table td {
    border: none;
    padding: 0;
  }
  .col-select {
    order: 1;
    width: auto;
  }
  .col-project {
    order: 2;
    flex: 1 1 auto;
    min-width: 200px;
  }
  .thumb {
    width: 36px;
    height: 36px;
  }
  .col-status {
    order: 3;
    width: auto;
  }
  .col-actions {
    order: 4;
    flex-basis: 100%;
    text-align: left;
  }
  .actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
