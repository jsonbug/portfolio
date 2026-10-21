<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getPublicProject } from '@/api/projects'
import ProjectCover from '@/components/ProjectCover.vue'
import { LINK_TYPE_LABELS, PROGRESS_LABELS, type ProjectDetail } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import { formatDate } from '@/utils/text'

const props = defineProps<{ slug: string }>()

const detail = ref<ProjectDetail | null>(null)
const loading = ref(true)
const error = ref('')

const descriptionHtml = computed(() =>
  detail.value?.description_md ? renderMarkdown(detail.value.description_md) : '',
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await getPublicProject(props.slug)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <main class="page detail">
    <nav class="back">
      <RouterLink :to="{ name: 'home' }">← 返回列表</RouterLink>
    </nav>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <template v-else-if="detail">
      <header class="hero">
        <ProjectCover :name="detail.name" :cover-image="detail.cover_image_url" variant="hero" />
        <div class="hero-body">
          <h1 class="name">{{ detail.name }}</h1>
          <p v-if="detail.summary" class="tagline">{{ detail.summary }}</p>
          <dl class="meta">
            <div v-if="detail.stars != null" class="meta-item">
              <dt>Stars</dt>
              <dd>★ {{ detail.stars }}</dd>
            </div>
            <div v-if="detail.role" class="meta-item">
              <dt>角色</dt>
              <dd>{{ detail.role }}</dd>
            </div>
            <div class="meta-item">
              <dt>进展</dt>
              <dd>{{ PROGRESS_LABELS[detail.progress] }}</dd>
            </div>
            <div v-if="detail.version" class="meta-item">
              <dt>版本</dt>
              <dd>{{ detail.version }}</dd>
            </div>
            <div v-if="detail.start_year" class="meta-item">
              <dt>起始年份</dt>
              <dd>{{ detail.start_year }}</dd>
            </div>
            <div v-if="detail.team_size != null" class="meta-item">
              <dt>团队规模</dt>
              <dd>{{ detail.team_size }} 人</dd>
            </div>
            <div v-if="detail.license" class="meta-item">
              <dt>许可</dt>
              <dd>{{ detail.license }}</dd>
            </div>
            <div v-if="detail.updated_at" class="meta-item">
              <dt>最近更新</dt>
              <dd>{{ formatDate(detail.updated_at) }}</dd>
            </div>
          </dl>
          <ul v-if="detail.tech_stack.length" class="tags" aria-label="技术栈">
            <li v-for="tech in detail.tech_stack" :key="tech" class="tag">{{ tech }}</li>
          </ul>
        </div>
      </header>

      <section v-if="detail.links.length" class="card section" aria-labelledby="links-title">
        <h2 id="links-title">链接</h2>
        <ul class="links">
          <li v-for="link in detail.links" :key="link.id" class="link">
            <span class="link-type">{{ LINK_TYPE_LABELS[link.type] }}</span>
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label || link.url }}</a>
          </li>
        </ul>
      </section>

      <section v-if="detail.metadata.length" class="card section" aria-labelledby="meta-kv-title">
        <h2 id="meta-kv-title">元数据</h2>
        <dl class="kv">
          <div v-for="row in detail.metadata" :key="row.key_label" class="kv-row">
            <dt>{{ row.key_label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="detail.description_md" class="card section" aria-labelledby="desc-title">
        <h2 id="desc-title">项目介绍</h2>
        <div class="markdown" v-html="descriptionHtml" />
      </section>

      <section v-if="detail.notes.length" class="card section" aria-labelledby="note-title">
        <h2 id="note-title">笔记</h2>
        <ul class="note-list">
          <li v-for="note in detail.notes" :key="note.id" class="note-item">
            <span class="note-title">{{ note.title }}</span>
            <span v-if="note.published_at" class="note-date">{{ formatDate(note.published_at) }}</span>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>
.detail {
  max-width: 56rem;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.back {
  font-size: 14px;
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
.hero {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.hero-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.name {
  margin: 0;
  font-size: 32px;
  color: var(--c-ink);
}
.tagline {
  margin: 0;
  font-size: 15px;
  color: var(--c-text);
}
.meta {
  margin: 0;
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-item dt {
  font-size: 12px;
  color: var(--c-text-secondary);
}
.meta-item dd {
  margin: 0;
  font-size: 14px;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}
.tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tag {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
  border-radius: var(--r-tag);
}
.section {
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.section h2 {
  margin: 0;
  font-size: 18px;
  color: var(--c-ink);
}
.links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.link {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
}
.link-type {
  flex: none;
  width: 56px;
  font-size: 12px;
  color: var(--c-text-secondary);
}
.kv {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--sp-2);
}
.kv-row dt {
  font-size: 12px;
  color: var(--c-text-secondary);
}
.kv-row dd {
  margin: 2px 0 0;
  font-size: 14px;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.note-item {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  font-size: 14px;
}
.note-date {
  color: var(--c-text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
/* 消毒后的 Markdown 排版 */
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  color: var(--c-ink);
  margin: var(--sp-2) 0 var(--sp-1);
}
.markdown :deep(h1) {
  font-size: 22px;
}
.markdown :deep(h2) {
  font-size: 18px;
}
.markdown :deep(h3) {
  font-size: 16px;
}
.markdown :deep(p) {
  margin: 0 0 var(--sp-1);
}
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 var(--sp-1);
  padding-left: 1.5em;
}
.markdown :deep(code) {
  font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  background: var(--c-fill);
  border-radius: var(--r-tag);
  padding: 1px 6px;
}
.markdown :deep(pre) {
  overflow: auto;
  background: var(--c-fill);
  border-radius: var(--r-control);
  padding: var(--sp-2);
}
.markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.markdown :deep(a) {
  color: var(--c-primary);
}
.markdown :deep(blockquote) {
  margin: 0 0 var(--sp-1);
  padding-left: var(--sp-2);
  border-left: 3px solid var(--c-border);
  color: var(--c-text-secondary);
}
</style>
