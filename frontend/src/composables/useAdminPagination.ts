import { computed, ref, type Ref } from 'vue'

export interface PageResult<T> {
  items: T[]
  total: number
}

/**
 * 后台列表的取数 + 分页（项目列表与笔记列表共用一份）。
 *
 * 为什么抽出来：这两页的分页口径必须一致（默认 20/页、页脚文案、页码按钮、
 * 「末页被删空自动回落」）。各写一份的下场是其中一页先修好、另一页继续把用户丢在空列表上。
 *
 * `allowFallback` 只对**自动回落**再放行一次：末页被删空（或手改 URL 到越界页）时，
 * 把页码拉回 `totalPages` 再取一次，避免出现「page=6、列表空、却没有分页控件」的不一致；
 * 回落一次仍空就照常显示空态，不做第二次递归。
 */
export function useAdminPagination<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PageResult<T>>,
  pageSize = 20,
) {
  const items = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const page = ref(1)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
  const loading = ref(false)
  const error = ref('')

  async function load(allowFallback = true): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const res = await fetchPage(page.value, pageSize)
      items.value = res.items
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

  function gotoPage(next: number): void {
    if (next < 1 || next > totalPages.value || next === page.value) return
    page.value = next
    void load()
  }

  /** 改筛选条件后回第 1 页（调用方随后自己 `load()`）。 */
  function resetToFirstPage(): void {
    page.value = 1
  }

  return { items, total, page, totalPages, loading, error, pageSize, load, gotoPage, resetToFirstPage }
}
