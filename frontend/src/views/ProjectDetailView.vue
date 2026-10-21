<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getPublicProject } from '@/api/projects'
import ProjectCover from '@/components/ProjectCover.vue'
import ProgressBadge from '@/components/ProgressBadge.vue'
import { LINK_TYPE_LABELS, type ProjectDetail } from '@/types'
import { bareDomain } from '@/utils/link'
import { renderMarkdown } from '@/utils/markdown'
import { formatDate } from '@/utils/text'

const props = defineProps<{ slug: string }>()

const detail = ref<ProjectDetail | null>(null)
const loading = ref(true)
const error = ref('')

const descriptionHtml = computed(() =>
  detail.value?.description_md ? renderMarkdown(detail.value.description_md) : '',
)

/** 头部指标行：`★ 128 · 1.4.0 · 2026-10-19 更新`，缺项自动省略。 */
const metrics = computed(() => {
  const item = detail.value
  if (!item) return []
  const parts: string[] = []
  if (item.stars != null) parts.push(`★ ${item.stars}`)
  if (item.version) parts.push(item.version)
  const updated = item.last_updated_at ?? item.updated_at
  if (updated) parts.push(`${formatDate(updated)} 更新`)
  return parts
})

/** 固定元数据列（空值整行不渲染）。 */
const fixedMeta = computed(() => {
  const item = detail.value
  if (!item) return []
  return [
    { label: '角色', value: item.role ?? '' },
    { label: '开源协议', value: item.license ?? '' },
    { label: '起始年份', value: item.start_year != null ? String(item.start_year) : '' },
    { label: '团队规模', value: item.team_size != null ? `${item.team_size} 人` : '' },
  ].filter((row) => row.value !== '')
})

const hasMetaPanel = computed(() => fixedMeta.value.length > 0 || (detail.value?.metadata.length ?? 0) > 0)
/** 三个 panel 全空时整段侧栏不渲染（不留空壳占位）。 */
const hasSidePanels = computed(
  () => hasMetaPanel.value || (detail.value?.links.length ?? 0) > 0 || (detail.value?.tech_stack.length ?? 0) > 0,
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
          <div class="title-row">
            <h1 class="name type-h1">{{ detail.name }}</h1>
            <ProgressBadge :progress="detail.progress" />
          </div>
          <p v-if="detail.summary" class="summary type-body">{{ detail.summary }}</p>
          <p v-if="metrics.length" class="metrics type-small">
            <span v-for="(part, index) in metrics" :key="part" class="metric tabular-nums">
              <span v-if="index > 0" class="metric-sep" aria-hidden="true">·</span>{{ part }}
            </span>
          </p>
        </div>
      </header>

      <div class="body-grid">
        <div class="column-main">
          <section v-if="descriptionHtml" class="card section" aria-labelledby="desc-title">
            <h2 id="desc-title">项目介绍</h2>
            <div class="markdown" v-html="descriptionHtml" />
          </section>

          <section v-if="detail.notes.length" class="card section" aria-labelledby="notes-title">
            <h2 id="notes-title">相关笔记</h2>
            <ul class="note-list">
              <li v-for="note in detail.notes" :key="note.id" class="note-item">
                <RouterLink :to="{ name: 'note-detail', params: { slug: note.slug } }" class="note-title">
                  {{ note.title }}
                </RouterLink>
                <span v-if="note.published_at" class="note-date tabular-nums">{{
                  formatDate(note.published_at)
                }}</span>
              </li>
            </ul>
          </section>
        </div>

        <aside v-if="hasSidePanels" class="column-side" aria-label="项目速览">
          <section v-if="hasMetaPanel" class="card section panel" aria-labelledby="meta-title">
            <h2 id="meta-title">元数据</h2>
            <dl class="kv">
              <div v-for="row in fixedMeta" :key="row.label" class="kv-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
              <div v-for="row in detail.metadata" :key="`kv-${row.key_label}`" class="kv-row">
                <dt>{{ row.key_label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="detail.links.length" class="card section panel" aria-labelledby="links-title">
            <h2 id="links-title">相关链接</h2>
            <ul class="links">
              <li v-for="link in detail.links" :key="link.id" class="link">
                <a :href="link.url" target="_blank" rel="noopener noreferrer" class="link-anchor">
                  <span class="link-type">{{ LINK_TYPE_LABELS[link.type] }}</span>
                  <span class="link-label">{{ link.label || bareDomain(link.url) }}</span>
                  <span class="link-host type-small">{{ bareDomain(link.url) }}</span>
                </a>
              </li>
            </ul>
          </section>

          <section v-if="detail.tech_stack.length" class="card section panel" aria-labelledby="tech-title">
            <h2 id="tech-title">技术栈</h2>
            <ul class="tags">
              <li v-for="tech in detail.tech_stack" :key="tech" class="tag">{{ tech }}</li>
            </ul>
          </section>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
}
.back {
  font-size: var(--fs-small);
}
.error {
  margin: 0;
  padding: var(--space-8) var(--space-12);
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
  gap: var(--space-24);
}
.hero-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}
.title-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
}
.name {
  margin: 0;
  color: var(--c-ink);
}
.summary {
  margin: 0;
  max-width: 68ch;
  color: var(--c-text);
}
.metrics {
  margin: 0;
  color: var(--c-text-secondary);
}
.metric-sep {
  margin: 0 var(--space-8);
}
/* 左栏内容 + 右栏 3 panel；窄屏单列堆叠 */
.body-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-24);
  align-items: start;
}
@media (max-width: 1023px) {
  .body-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.column-main,
.column-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
  min-width: 0;
}
.section {
  padding: var(--space-24);
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}
.section h2 {
  margin: 0;
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  color: var(--c-ink);
}
.panel {
  gap: var(--space-12);
}
.links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.link-anchor {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px var(--space-8);
  padding: var(--space-8);
  min-height: var(--touch-min);
  align-content: center;
  text-decoration: none;
  border-radius: var(--r-control);
}
.link-anchor:hover {
  background: var(--c-fill);
}
.link-anchor:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.link-type {
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
  color: var(--c-text-secondary);
}
.link-label {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--c-primary-strong);
}
.link-host {
  grid-column: 2;
  color: var(--c-text-secondary);
}
.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-16);
  font-size: var(--fs-small);
  line-height: var(--lh-small);
}
.kv-row dt {
  color: var(--c-text-secondary);
}
.kv-row dd {
  margin: 0;
  color: var(--c-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;
}
.tag {
  padding: 2px 10px;
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
  border-radius: var(--r-tag);
}
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.note-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-16);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.note-title {
  color: var(--c-text);
  text-decoration: none;
}
.note-title:hover {
  color: var(--c-primary-strong);
}
.note-date {
  color: var(--c-text-secondary);
  font-size: var(--fs-small);
}
/* 消毒后的 Markdown 排版 */
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  color: var(--c-ink);
  margin: var(--space-16) 0 var(--space-8);
}
.markdown :deep(h1) {
  font-size: var(--fs-h2);
  line-height: var(--lh-h2);
}
.markdown :deep(h2) {
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
}
.markdown :deep(h3) {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.markdown :deep(p) {
  margin: 0 0 var(--space-12);
}
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 var(--space-12);
  padding-left: 1.5em;
}
.markdown :deep(code) {
  font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
  font-size: var(--fs-mono);
  background: var(--c-fill);
  border-radius: var(--r-tag);
  padding: 1px 6px;
}
.markdown :deep(pre) {
  overflow: auto;
  background: var(--c-fill);
  border-radius: var(--r-control);
  padding: var(--space-16);
}
.markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.markdown :deep(a) {
  color: var(--c-primary);
}
.markdown :deep(blockquote) {
  margin: 0 0 var(--space-12);
  padding-left: var(--space-16);
  border-left: 3px solid var(--c-border);
  color: var(--c-text-secondary);
}
</style>
