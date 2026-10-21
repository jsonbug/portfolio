<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import {
  DEFAULT_FILTERS,
  SEGMENTS,
  SORT_OPTIONS,
  isDefaultFilters,
  type ProjectListFilters,
} from '@/composables/useProjectListFilters'
import { debounce } from '@/utils/timing'
import type { ProjectSort, ProjectListCounts, Progress } from '@/types'

/**
 * 筛选条：分段（全部/进行中/已上线）+ 搜索（300ms 防抖）+ 技术栈多选 + 排序 + 清除筛选。
 * 组件不持有筛选状态：改动一律 emit 出去，由视图写回 URL（唯一真源）。
 */
const props = defineProps<{
  filters: ProjectListFilters
  counts: ProjectListCounts
  technologies: string[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<ProjectListFilters>]
  search: [q: string]
  /** 技术栈只发「点了哪个」，由父级基于最新筛选值计算下一份数组（避免连点读到过期 props）。 */
  toggleTech: [tech: string]
}>()

const searchText = ref(props.filters.q)
const commitSearch = debounce((value: string) => emit('search', value), 300)
let suppress = false

// 前进/后退或 URL 被外部改写时，把搜索框同步回 URL 的值（不再回传，避免循环）。
watch(
  () => props.filters.q,
  (q) => {
    if (q === searchText.value) return
    suppress = true
    searchText.value = q
    commitSearch.cancel()
    suppress = false
  },
  { flush: 'sync' },
)

watch(
  searchText,
  (value) => {
    if (!suppress) commitSearch(value)
  },
  { flush: 'sync' },
)

onBeforeUnmount(() => commitSearch.cancel())

function submitSearch(): void {
  commitSearch.cancel()
  emit('search', searchText.value)
}

function countOf(segment: Progress | null): number {
  if (segment === null) return props.counts.all
  return props.counts[segment]
}

function selectSegment(segment: Progress | null): void {
  emit('update', { progress: segment })
}

function changeSort(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ProjectSort
  emit('update', { sort: value })
}

function clearAll(): void {
  commitSearch.cancel()
  searchText.value = ''
  emit('update', { ...DEFAULT_FILTERS })
}
</script>

<template>
  <div class="filter-bar">
    <div class="filter-row">
      <nav class="segments" aria-label="项目分段">
        <button
          v-for="segment in SEGMENTS"
          :key="segment.label"
          type="button"
          class="segment"
          :class="{ 'segment--active': filters.progress === segment.value }"
          :aria-label="`${segment.label} ${countOf(segment.value)}`"
          :aria-pressed="filters.progress === segment.value"
          @click="selectSegment(segment.value)"
        >
          {{ segment.label }}<span class="segment-count tabular-nums">{{ countOf(segment.value) }}</span>
        </button>
      </nav>

      <form class="search" role="search" @submit.prevent="submitSearch">
        <input
          v-model="searchText"
          class="input search-input"
          type="search"
          aria-label="搜索项目"
          placeholder="搜索项目名称或简介"
        />
      </form>

      <label class="sort">
        <span class="sort-label">排序</span>
        <select class="select" aria-label="排序" :value="filters.sort" @change="changeSort">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <div class="filter-row filter-row--tech">
      <div v-if="technologies.length" class="techs" role="group" aria-label="技术栈筛选">
        <button
          v-for="tech in technologies"
          :key="tech"
          type="button"
          class="tag tech"
          :class="{ 'tech--active': filters.tech.includes(tech) }"
          :aria-pressed="filters.tech.includes(tech)"
          @click="emit('toggleTech', tech)"
        >
          {{ tech }}
        </button>
      </div>
      <button
        v-if="!isDefaultFilters(filters)"
        type="button"
        class="btn btn-ghost btn-sm clear"
        @click="clearAll"
      >
        清除筛选
      </button>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  margin-bottom: var(--space-24);
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
}
.filter-row--tech {
  gap: var(--space-4);
}
.segments {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.segment {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 32px;
  padding: 0 var(--space-12);
  border: 0;
  border-radius: var(--r-tag);
  background: transparent;
  color: var(--c-text-secondary);
  font-size: var(--fs-small);
  cursor: pointer;
}
.segment:hover {
  color: var(--c-ink);
}
.segment--active {
  background: var(--c-surface);
  color: var(--c-ink);
  font-weight: var(--fw-semibold);
  box-shadow: var(--shadow-e1);
}
.segment-count {
  font-size: var(--fs-mono);
  color: var(--c-text-secondary);
}
.search {
  flex: 1 1 240px;
  min-width: 200px;
}
.search-input {
  width: 100%;
}
.sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}
.sort-label {
  font-size: var(--fs-small);
  color: var(--c-text-secondary);
}
.techs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.tech {
  padding: 2px var(--space-8);
  border: 1px solid transparent;
  border-radius: var(--r-tag);
  background: var(--c-fill);
  color: var(--c-text-secondary);
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
  min-height: 28px;
  cursor: pointer;
}
.tech:hover {
  color: var(--c-ink);
}
.tech--active {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary-strong);
}
.clear {
  margin-left: auto;
}
</style>
