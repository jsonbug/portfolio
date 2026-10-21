<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPublicNote, listPublicNotes } from '@/api/notes'
import { renderMarkdown } from '@/utils/markdown'
import { debounce } from '@/utils/timing'
import { MAX_SEARCH_LENGTH, clampSearch, formatDate, readingTimeMinutes } from '@/utils/text'
import type { NoteDetail, NoteSummary } from '@/types'

/** 契约 §3.3：`/notes` 单页上限 100，超出必须明确提示。 */
const NOTES_PAGE_SIZE = 100

const route = useRoute()
const router = useRouter()

const items = ref<NoteSummary[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref('')

const detail = ref<NoteDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailSeq = 0

const searchText = ref(clampSearch(typeof route.query.q === 'string' ? route.query.q : ''))
const selectedSlug = computed(() => {
  const note = route.query.note
  return typeof note === 'string' && note ? note : (items.value[0]?.slug ?? '')
})

/** 左栏按项目分组，保持后端返回（published_at 倒序）的顺序。 */
const groups = computed(() => {
  const map = new Map<string, { name: string; notes: NoteSummary[] }>()
  for (const note of items.value) {
    const group = map.get(note.project.slug) ?? { name: note.project.name, notes: [] }
    group.notes.push(note)
    map.set(note.project.slug, group)
  }
  return [...map.entries()].map(([slug, group]) => ({ slug, ...group }))
})

const truncated = computed(() => total.value > NOTES_PAGE_SIZE)

/** 当前选中的笔记被搜索/分页挡在列表外（正文仍可看，但左栏里找不到它）。 */
const selectedHidden = computed(
  () => !!selectedSlug.value && items.value.length > 0 && !items.value.some((n) => n.slug === selectedSlug.value),
)

/** 正文区：切换笔记后把焦点交给它，键盘用户不用再 Tab 一大圈。 */
const bodyRef = ref<HTMLElement | null>(null)

/** 语音提示区文案（右栏 aria-live 用，避免整段正文被重读）。 */
const liveText = computed(() =>
  detail.value ? `已打开笔记：${detail.value.title}，约 ${readMinutes.value} 分钟` : '',
)

const bodyHtml = computed(() => (detail.value ? renderMarkdown(detail.value.body_md) : ''))
const readMinutes = computed(() => (detail.value ? readingTimeMinutes(detail.value.body_md) : 0))

async function loadList(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await listPublicNotes({
      search: clampSearch(searchText.value) || undefined,
      page: 1,
      pageSize: NOTES_PAGE_SIZE,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail(slug: string): Promise<void> {
  if (!slug) {
    detail.value = null
    return
  }
  const mine = ++detailSeq
  detailLoading.value = true
  detailError.value = ''
  try {
    const note = await getPublicNote(slug)
    if (mine !== detailSeq) return
    detail.value = note
  } catch (e) {
    if (mine !== detailSeq) return
    detail.value = null
    detailError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (mine === detailSeq) detailLoading.value = false
  }
}

// 搜索 300ms 防抖后落到 URL，URL 仍是唯一真源；输入框与 URL 共用 clampSearch 收口。
const commitSearch = debounce((value: string) => {
  const q = clampSearch(value)
  void router.replace({ query: { ...route.query, q: q || undefined } })
}, 300)
onUnmounted(() => commitSearch.cancel())

watch(searchText, (value) => commitSearch(value))
watch(() => route.query.q, (value) => {
  const next = typeof value === 'string' ? value : ''
  if (next !== searchText.value) searchText.value = next
})
watch(() => route.query.q, () => void loadList(), { immediate: true })
watch(selectedSlug, (slug) => void loadDetail(slug), { immediate: true })
// 首次进入（URL 里没有 ?note=）时把默认选中的第一篇写回地址栏：URL 是唯一真源，不能漏格。
watch(
  items,
  (list) => {
    if (route.query.note || !list.length) return
    void router.replace({ query: { ...route.query, note: list[0].slug } })
  },
  { immediate: true },
)
watch(selectedSlug, async () => {
  await nextTick()
  bodyRef.value?.focus()
})
</script>

<template>
  <main class="page notes">
    <header class="notes-header">
      <h1 class="type-display">笔记</h1>
      <p class="type-small notes-summary">{{ total }} 篇 · 按项目分组</p>
    </header>

    <label class="search field">
      <span class="field-label">搜索笔记</span>
      <input
        v-model="searchText"
        class="input"
        type="search"
        placeholder="标题或正文"
        :maxlength="MAX_SEARCH_LENGTH"
      />
    </label>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading && !items.length" class="hint">加载中…</p>

    <div v-else class="notes-grid">
      <nav class="notes-list" aria-label="笔记列表">
        <p v-if="truncated" class="truncated">仅显示最近 {{ NOTES_PAGE_SIZE }} 篇</p>
        <p v-if="selectedHidden" class="hidden-note type-small">当前笔记不在筛选结果内</p>
        <p v-if="!groups.length" class="hint empty">
          {{ searchText ? '没有匹配的笔记' : '还没有笔记' }}
        </p>
        <section v-for="group in groups" :key="group.slug" class="note-group">
          <h2 class="group-title type-small">{{ group.name }}</h2>
          <ul class="note-items">
            <li v-for="note in group.notes" :key="note.id">
              <button
                type="button"
                class="note-link"
                :class="{ 'note-link--active': note.slug === selectedSlug }"
                :aria-current="note.slug === selectedSlug ? 'true' : undefined"
                @click="router.replace({ query: { ...route.query, note: note.slug } })"
              >
                <span class="note-title">{{ note.title }}</span>
                <span class="note-date type-mono tabular-nums">{{ formatDate(note.published_at ?? note.updated_at) }}</span>
              </button>
            </li>
          </ul>
        </section>
      </nav>

      <article ref="bodyRef" class="note-body card" tabindex="-1" aria-labelledby="note-body-title">
        <p class="sr-only" aria-live="polite">{{ liveText }}</p>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <p v-else-if="detailLoading && !detail" class="hint">加载中…</p>
        <template v-else-if="detail">
          <header class="note-head">
            <h2 id="note-body-title" class="type-h2">{{ detail.title }}</h2>
            <p class="note-meta type-small">
              <span>{{ detail.project.name }}</span>
              <span aria-hidden="true">·</span>
              <span class="tabular-nums">{{ formatDate(detail.published_at ?? detail.updated_at) }}</span>
              <span aria-hidden="true">·</span>
              <span>约 {{ readMinutes }} 分钟</span>
            </p>
            <div class="note-actions">
              <RouterLink :to="{ name: 'note-detail', params: { slug: detail.slug } }" class="btn btn-ghost btn-sm">
                打开完整页 →
              </RouterLink>
            </div>
          </header>
          <div class="markdown" v-html="bodyHtml" />
        </template>
        <p v-else class="hint">选择左侧笔记查看正文。</p>
      </article>
    </div>
  </main>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}
.notes-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-16);
  flex-wrap: wrap;
}
.notes-header h1 {
  margin: 0;
  color: var(--c-ink);
}
.notes-summary {
  margin: 0;
  color: var(--c-text-secondary);
}
.search {
  max-width: 420px;
}
.notes-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: var(--space-24);
  align-items: start;
}
@media (max-width: 959px) {
  .notes-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  position: sticky;
  top: var(--space-24);
}
.note-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.group-title {
  margin: 0;
  color: var(--c-text-secondary);
  font-weight: var(--fw-semibold);
}
.note-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.note-link {
  width: 100%;
  min-height: var(--touch-min);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-8) var(--space-12);
  text-align: left;
  background: none;
  border: 0;
  border-radius: var(--r-control);
  font: inherit;
  color: var(--c-text);
  cursor: pointer;
}
.note-link:hover {
  background: var(--c-fill);
}
.note-link:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.note-link--active {
  background: var(--c-primary-soft);
  color: var(--c-primary-strong);
}
.note-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.note-date {
  color: var(--c-text-secondary);
}
.note-body {
  padding: var(--space-24);
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  min-width: 0;
}
.note-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.note-head h2 {
  margin: 0;
  color: var(--c-ink);
}
.note-meta {
  margin: 0;
  display: flex;
  gap: var(--space-8);
  color: var(--c-text-secondary);
  flex-wrap: wrap;
}
.truncated,
.hint {
  margin: 0;
}
.truncated {
  font-size: var(--fs-small);
  color: var(--c-text-secondary);
}
.error {
  margin: 0;
  padding: var(--space-8) var(--space-12);
  color: var(--c-danger);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  color: var(--c-ink);
  margin: var(--space-16) 0 var(--space-8);
}
.markdown :deep(h2) {
  font-size: var(--fs-h2);
  line-height: var(--lh-h2);
}
.markdown :deep(h3) {
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
}
.markdown :deep(p) {
  margin: 0 0 var(--space-12);
}
.markdown :deep(pre) {
  overflow: auto;
  background: var(--c-fill);
  border-radius: var(--r-control);
  padding: var(--space-16);
}
.markdown :deep(code) {
  font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
  font-size: var(--fs-mono);
  background: var(--c-fill);
  border-radius: var(--r-tag);
  padding: 1px 6px;
}
.markdown :deep(a) {
  color: var(--c-primary);
}
.hidden-note {
  margin: 0 var(--space-8) var(--space-8);
  padding: var(--space-4) var(--space-8);
  color: var(--c-warning);
  background: var(--c-fill);
  border-radius: var(--r-tag);
}
</style>
