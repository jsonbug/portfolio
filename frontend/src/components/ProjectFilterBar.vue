<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  DEFAULT_FILTERS,
  SEGMENTS,
  SORT_OPTIONS,
  isDefaultFilters,
  type ProjectListFilters,
} from '@/composables/useProjectListFilters'
import { debounce } from '@/utils/timing'
import { MAX_SEARCH_LENGTH, clampSearch } from '@/utils/text'
import type { ProjectSort, ProjectListCounts, Progress } from '@/types'

/**
 * 筛选条（01 稿）：单行容器 = 分段 | 搜索 | 技术栈下拉 | 排序 | 清除筛选。
 *
 * 技术栈从「一排 chip」改成下拉多选：选项一多就会把筛选条顶成两行（01 稿要求单行），
 * 所以收进面板；面板里必须能看见「已选几个 + 具体选了哪些」，不能只在触发按钮上换个颜色。
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

/* ---------------- 技术栈下拉 ---------------- */
const techOpen = ref(false)
const panelEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLElement | null>(null)

const selectedTech = computed(() => props.filters.tech)

function togglePanel(): void {
  techOpen.value = !techOpen.value
}

function closePanel(): void {
  techOpen.value = false
  triggerEl.value?.focus()
}

/** 点面板以外的地方收起；Escape 也收起并把焦点还给触发按钮。 */
function onDocumentPointerDown(event: MouseEvent): void {
  const target = event.target as Node | null
  if (!techOpen.value || !target) return
  if (panelEl.value?.contains(target) || triggerEl.value?.contains(target)) return
  techOpen.value = false
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && techOpen.value) closePanel()
}

watch(techOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  commitSearch.cancel()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function submitSearch(): void {
  commitSearch.cancel()
  emit('search', clampSearch(searchText.value))
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

function clearTech(): void {
  emit('update', { tech: [] })
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
          :maxlength="MAX_SEARCH_LENGTH"
          aria-label="搜索项目"
          placeholder="搜索项目名称或简介"
        />
      </form>

      <div v-if="technologies.length" class="tech-dropdown">
        <button
          ref="triggerEl"
          type="button"
          class="tech-trigger"
          :class="{ 'tech-trigger--active': selectedTech.length > 0 }"
          :aria-expanded="techOpen"
          aria-controls="tech-panel"
          data-testid="tech-trigger"
          @click="togglePanel"
        >
          技术栈
          <span v-if="selectedTech.length" class="tech-badge tabular-nums">{{ selectedTech.length }}</span>
          <svg class="caret" viewBox="0 0 10 6" aria-hidden="true" focusable="false">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>

        <div
          v-show="techOpen"
          id="tech-panel"
          ref="panelEl"
          class="tech-panel"
          role="group"
          aria-label="技术栈筛选"
        >
          <div class="tech-panel-head">
            <span class="type-small">已选 {{ selectedTech.length }} 个</span>
            <button
              v-if="selectedTech.length"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="clearTech"
            >
              清空
            </button>
          </div>

          <!-- 已选列表：不靠颜色，直接把选中的名字列出来 -->
          <ul v-if="selectedTech.length" class="tech-selected" aria-label="已选技术栈">
            <li v-for="tech in selectedTech" :key="tech">
              <button
                type="button"
                class="tech-chip tech-chip--active"
                :aria-label="`移除 ${tech}`"
                @click="emit('toggleTech', tech)"
              >
                {{ tech }}<span aria-hidden="true">×</span>
              </button>
            </li>
          </ul>

          <ul class="tech-options">
            <li v-for="tech in technologies" :key="tech">
              <button
                type="button"
                class="tech-option"
                :class="{ 'tech-option--active': selectedTech.includes(tech) }"
                :aria-pressed="selectedTech.includes(tech)"
                @click="emit('toggleTech', tech)"
              >
                <span class="tech-check" aria-hidden="true">{{
                  selectedTech.includes(tech) ? '✓' : ''
                }}</span>
                {{ tech }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <label class="sort">
        <span class="sort-label">排序</span>
        <select class="select" aria-label="排序" :value="filters.sort" @change="changeSort">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

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
  margin-bottom: var(--space-24);
}
/* 01 稿：筛选条是**一条**容器，控件从左到右排开，窄屏才允许换行 */
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-12);
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface);
}
/* 分段控件与页码的样式在 style.css（通用控件层），这里只放本页专有的布局 */
.search {
  flex: 1 1 220px;
  min-width: 160px;
}
.search-input {
  width: 100%;
}
.sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  flex: none;
}
.sort-label {
  font-size: var(--fs-small);
  color: var(--c-text-secondary);
  /* 否则被挤压时会断成「排 / 序」两行 */
  white-space: nowrap;
}
.tech-dropdown {
  position: relative;
  flex: none;
}
.tech-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  height: var(--control-h);
  padding: 0 var(--space-12);
  border: 1px solid var(--c-control-border);
  border-radius: var(--r-control);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: var(--fs-small);
  cursor: pointer;
}
.tech-trigger--active {
  border-color: var(--c-primary);
  color: var(--c-primary-strong);
}
.tech-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-pill);
  background: var(--c-primary-soft);
  color: var(--c-primary-strong);
  font-size: 11.5px;
  line-height: 1;
}
.caret {
  width: 10px;
  height: 6px;
  color: var(--c-text-secondary);
}
.tech-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: 240px;
  padding: var(--space-12);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface);
  box-shadow: var(--shadow-e2);
}
.tech-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  color: var(--c-text-secondary);
}
.tech-selected,
.tech-options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.tech-selected {
  padding-bottom: var(--space-8);
  border-bottom: 1px solid var(--c-border);
}
.tech-options {
  max-height: 220px;
  overflow: auto;
  /* 必须关掉 wrap：flex-direction: column + wrap 会横向分成多列 */
  flex-wrap: nowrap;
  flex-direction: column;
}
.tech-options > li {
  width: 100%;
}
.tech-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 26px;
  padding: 0 var(--space-8);
  border: 1px solid var(--c-primary);
  border-radius: var(--r-tag);
  background: var(--c-primary-soft);
  color: var(--c-primary-strong);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
}
.tech-option {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-height: 28px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--r-tag);
  background: transparent;
  color: var(--c-text);
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.tech-option:hover {
  background: var(--c-fill);
}
.tech-option--active {
  color: var(--c-primary-strong);
  font-weight: var(--fw-semibold);
}
.tech-check {
  width: 12px;
  flex: none;
  color: var(--c-primary-strong);
}
.clear {
  margin-left: auto;
}
</style>
