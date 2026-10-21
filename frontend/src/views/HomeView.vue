<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listTechnologies } from '@/api/technologies'
import ProjectCard from '@/components/ProjectCard.vue'
import ProjectCardSkeleton from '@/components/ProjectCardSkeleton.vue'
import ProjectEmptyState from '@/components/ProjectEmptyState.vue'
import ProjectFilterBar from '@/components/ProjectFilterBar.vue'
import { LIST_PAGE_SIZE, useProjectList } from '@/composables/useProjectList'
import { clampSearch } from '@/utils/text'
import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  parseFilters,
  toQuery,
  type ProjectListFilters,
} from '@/composables/useProjectListFilters'
import { daysAgo } from '@/utils/text'

/**
 * 前台项目列表。
 *
 * 数据流：URL query 是筛选条件的唯一真源 → `filters`(computed) → useProjectList 拉取。
 * 任何交互都只改 URL（router.replace），因此刷新、分享、前进后退都自然一致。
 */
const route = useRoute()
const router = useRouter()

const filters = computed(() => parseFilters(route.query))
const { items, counts, total, loading, error, reload } = useProjectList(filters)

const technologies = ref<string[]>([])

onMounted(async () => {
  try {
    technologies.value = (await listTechnologies()).items
  } catch {
    // 技术栈选项拿不到不影响列表主体，只是少一个筛选维度。
    technologies.value = []
  }
})

const filtered = computed(() => !isDefaultFilters(filters.value))

/** 页头汇总里的「最近更新」：取当前结果集里最新的一次更新。 */
const recentText = computed(() => {
  const stamps = items.value
    .map((item) => item.last_updated_at ?? item.updated_at)
    .filter((iso): iso is string => Boolean(iso))
    .map((iso) => new Date(iso).getTime())
    .filter((time) => !Number.isNaN(time))
  if (!stamps.length) return ''
  return recentPhrase(daysAgo(new Date(Math.max(...stamps)).toISOString()))
})

/** 页头文案：0 天说「今天更新」，否则「最近更新 N 天前」。 */
function recentPhrase(days: number | null): string {
  if (days === null) return ''
  return days <= 0 ? '今天更新' : `最近更新 ${days} 天前`
}

const showSkeleton = computed(() => loading.value && items.value.length === 0)
/** 一次只取 50 条：结果更多时明确提示，不静默截断。 */
const truncated = computed(() => total.value > LIST_PAGE_SIZE)
const showEmpty = computed(() => !loading.value && !error.value && items.value.length === 0)
/** 供读屏播报结果数量变化（视觉上无对应元素）。 */
const resultAnnouncement = computed(() =>
  loading.value ? '正在加载项目' : `共 ${total.value} 个结果`,
)

/**
 * 已经发起、但路由还没落定的筛选值。
 *
 * `router.replace` 是异步的，同一 tick 内连续两次交互（连点技术栈、快速切分段）时
 * `route.query` 还是旧值，若以它为基准算下一份筛选就会把上一次改动覆盖掉。
 * 这里记住最后一次提交的值作为基准，路由落定后清空。
 */
let pending: ProjectListFilters | null = null

watch(
  () => route.query,
  () => {
    pending = null
  },
  { flush: 'sync' },
)

function apply(patch: Partial<ProjectListFilters>): void {
  if (patch.q !== undefined) patch = { ...patch, q: clampSearch(patch.q) }
  // 基准取实时路由 query 解析出来的值（不是可能过期的 computed）；
  // `pending` 只用来补「replace 还没落定」的那段时间。
  const base = pending ?? parseFilters(router.currentRoute.value.query)
  const next: ProjectListFilters = { ...base, ...patch }
  const current = JSON.stringify(toQuery(base))
  const target = JSON.stringify(toQuery(next))
  if (current === target) return
  pending = next
  void router.replace({ query: toQuery(next) })
}

/** 技术栈开合：以「最后一次提交的筛选值」为基准算下一份数组，连点也不会丢改动。 */
function toggleTech(tech: string): void {
  const base = pending ?? parseFilters(router.currentRoute.value.query)
  const next = base.tech.includes(tech)
    ? base.tech.filter((t) => t !== tech)
    : [...base.tech, tech]
  apply({ tech: next })
}

function clearFilters(): void {
  apply({ ...DEFAULT_FILTERS })
}
</script>

<template>
  <main class="home">
    <header class="home-header">
      <h1 class="type-display">项目</h1>
      <p v-if="!showSkeleton && total > 0" class="home-summary">
        <span class="tabular-nums">{{ total }} 个项目</span>
        <span v-if="recentText" aria-hidden="true"> · </span>
        <span v-if="recentText">{{ recentText }}</span>
      </p>
    </header>

    <ProjectFilterBar
      :filters="filters"
      :counts="counts"
      :technologies="technologies"
      @update="apply"
      @search="(q) => apply({ q })"
      @toggle-tech="toggleTech"
    />

    <p class="sr-only" aria-live="polite">{{ resultAnnouncement }}</p>

    <p v-if="error" class="error" role="alert">
      {{ error }}
      <button type="button" class="btn btn-sm" @click="reload">重试</button>
    </p>

    <ProjectCardSkeleton v-if="showSkeleton" />

    <ProjectEmptyState v-else-if="showEmpty" :filtered="filtered" @clear="clearFilters" />

    <template v-else>
      <ul class="grid" :aria-busy="loading">
        <li v-for="item in items" :key="item.id">
          <ProjectCard :item="item" />
        </li>
      </ul>
      <p v-if="truncated" class="truncated">
        仅显示前 {{ LIST_PAGE_SIZE }} 个，请用搜索/筛选缩小范围
      </p>
    </template>
  </main>
</template>

<style scoped>
.home-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  margin-bottom: var(--space-24);
}
.home-header h1 {
  margin: 0;
  color: var(--c-ink);
}
.home-summary {
  margin: 0;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}
.error {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  margin: 0 0 var(--space-24);
  padding: var(--space-12) var(--space-16);
  border-radius: var(--r-control);
  background: var(--c-fill);
  color: var(--c-danger);
  font-size: var(--fs-small);
}
.truncated {
  margin: var(--space-16) 0 0;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
  text-align: center;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
}
@media (min-width: 768px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1280px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
