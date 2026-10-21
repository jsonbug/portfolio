<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MAX_SEARCH_LENGTH, clampSearch, formatDate } from '@/utils/text'
import { debounce } from '@/utils/timing'
import type { NoteSummary } from '@/types'

/**
 * 笔记树：搜索框 + 按项目分组的笔记列表 + 选中项白卡。
 *
 * `/notes` 与 `/notes/:slug`（09/10 稿）左栏是同一棵树，抽成一件共用件：
 * 两处各写一份，选中态和防抖迟早长歪。
 */
const props = defineProps<{
  items: NoteSummary[]
  selectedSlug: string
  search: string
  total: number
  pageSize: number
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  select: [slug: string]
}>()

const searchText = ref(props.search)
const commit = debounce((value: string) => emit('update:search', clampSearch(value)), 300)
let suppress = false

watch(
  () => props.search,
  (value) => {
    if (value === searchText.value) return
    suppress = true
    searchText.value = value
    commit.cancel()
    suppress = false
  },
  { flush: 'sync' },
)

watch(
  searchText,
  (value) => {
    if (!suppress) commit(value)
  },
  { flush: 'sync' },
)

onBeforeUnmount(() => commit.cancel())

/** 按项目分组，保持后端返回（published_at 倒序）的顺序。 */
const groups = computed(() => {
  const map = new Map<string, { name: string; notes: NoteSummary[] }>()
  for (const note of props.items) {
    const group = map.get(note.project.slug) ?? { name: note.project.name, notes: [] }
    group.notes.push(note)
    map.set(note.project.slug, group)
  }
  return [...map.entries()].map(([slug, group]) => ({ slug, ...group }))
})

const truncated = computed(() => props.total > props.pageSize)

/** 当前选中的笔记被搜索挡在列表外（正文仍可看，但树里找不到它）。 */
const selectedHidden = computed(
  () => !!props.selectedSlug && props.items.length > 0 && !props.items.some((n) => n.slug === props.selectedSlug),
)
</script>

<template>
  <div class="note-tree">
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

    <nav class="notes-list" aria-label="笔记列表">
      <p v-if="truncated" class="truncated">仅显示最近 {{ pageSize }} 篇</p>
      <p v-if="selectedHidden" class="hidden-note type-small">当前笔记不在筛选结果内</p>
      <p v-if="!groups.length" class="hint empty">{{ searchText ? '没有匹配的笔记' : '还没有笔记' }}</p>
      <section v-for="group in groups" :key="group.slug" class="note-group">
        <h2 class="group-title type-small">{{ group.name }}</h2>
        <ul class="note-items">
          <li v-for="note in group.notes" :key="note.id">
            <button
              type="button"
              class="note-link"
              :class="{ 'note-link--active': note.slug === selectedSlug }"
              :aria-current="note.slug === selectedSlug ? 'true' : undefined"
              @click="emit('select', note.slug)"
            >
              <span class="note-title">{{ note.title }}</span>
              <span class="note-date type-mono tabular-nums">{{
                formatDate(note.published_at ?? note.updated_at)
              }}</span>
            </button>
          </li>
        </ul>
      </section>
    </nav>
  </div>
</template>

<style scoped>
.note-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}
.search {
  margin: 0;
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}
.truncated,
.hidden-note {
  margin: 0;
  color: var(--c-text-secondary);
}
.note-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: var(--touch-min);
  padding: var(--space-8) var(--space-12);
  border: 1px solid transparent;
  border-radius: var(--r-control);
  background: transparent;
  color: var(--c-text);
  text-align: left;
  cursor: pointer;
}
.note-link:hover {
  background: var(--c-fill);
}
/* 选中项：白卡 + 主色描边（09/10 稿） */
.note-link--active {
  border-color: var(--c-border);
  background: var(--c-surface);
  box-shadow: var(--shadow-e1);
  color: var(--c-ink);
  font-weight: var(--fw-semibold);
}
.note-title {
  font-size: var(--fs-small);
  line-height: var(--lh-small);
}
.note-date {
  color: var(--c-text-secondary);
}
</style>
