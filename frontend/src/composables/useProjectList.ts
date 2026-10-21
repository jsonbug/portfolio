import { ref, watch, type Ref } from 'vue'
import { listPublicProjects } from '@/api/projects'
import type { ProjectListItem, ProjectListCounts } from '@/types'
import type { ProjectListFilters } from './useProjectListFilters'

const EMPTY_COUNTS: ProjectListCounts = { all: 0, ongoing: 0, launched: 0 }

/**
 * 前台项目列表：筛选条件变化即重新拉取。
 *
 * - 竞态：用自增序号丢弃过期响应（快速连点分段/翻页时旧响应可能后到）；
 * - 加载态：首屏与筛选切换都置 loading，由视图决定骨架 or 保持旧列表；
 * - 错误：保留上一次成功的列表，仅暴露 error 文案。
 */
export function useProjectList(filters: Ref<ProjectListFilters>) {
  const items = ref<ProjectListItem[]>([])
  const counts = ref<ProjectListCounts>({ ...EMPTY_COUNTS })
  const loading = ref(true)
  const error = ref('')
  let seq = 0

  async function load(): Promise<void> {
    const mine = ++seq
    loading.value = true
    error.value = ''
    try {
      const res = await listPublicProjects({
        page: 1,
        // 一次拿全量（展示站项目量级在百以内）；超过上限时后端会夹到 100。
        pageSize: 50,
        search: filters.value.q.trim() || undefined,
        technology: filters.value.tech.length ? filters.value.tech : undefined,
        progress: filters.value.progress ?? undefined,
        sort: filters.value.sort,
      })
      if (mine !== seq) return
      items.value = res.items
      counts.value = res.counts
    } catch (e) {
      if (mine !== seq) return
      error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  // 只按「序列化后的筛选值」重取：filters 是 computed，同一 URL 重新解析会返回新对象，
  // 直接监听对象会多打一次请求。
  watch(() => JSON.stringify(filters.value), () => void load(), { immediate: true })

  return { items, counts, loading, error, reload: load }
}
