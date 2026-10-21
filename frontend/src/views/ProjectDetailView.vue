<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getPublicProject } from '@/api/projects'
import ProjectCover from '@/components/ProjectCover.vue'
import { LINK_TYPE_LABELS, PROJECT_LIFECYCLE_LABELS, type ProjectDetail } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import { formatDate } from '@/utils/text'

const props = defineProps<{ id: string }>()

const detail = ref<ProjectDetail | null>(null)
const loading = ref(true)
const error = ref('')

const descriptionHtml = computed(() =>
  detail.value?.description ? renderMarkdown(detail.value.description) : '',
)
const noteHtml = computed(() =>
  detail.value?.note?.content ? renderMarkdown(detail.value.note.content) : '',
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await getPublicProject(props.id)
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
        <ProjectCover :name="detail.name" :cover-image="detail.coverImage" variant="hero" />
        <div class="hero-body">
          <h1 class="name">{{ detail.name }}</h1>
          <p v-if="detail.tagline" class="tagline">{{ detail.tagline }}</p>
          <dl class="meta">
            <div v-if="detail.stars != null" class="meta-item">
              <dt>Stars</dt>
              <dd>★ {{ detail.stars }}</dd>
            </div>
            <div v-if="detail.role" class="meta-item">
              <dt>角色</dt>
              <dd>{{ detail.role }}</dd>
            </div>
            <div v-if="detail.projectStatus" class="meta-item">
              <dt>状态</dt>
              <dd>{{ PROJECT_LIFECYCLE_LABELS[detail.projectStatus] }}</dd>
            </div>
            <div v-if="detail.startDate || detail.endDate" class="meta-item">
              <dt>周期</dt>
              <dd>
                {{ formatDate(detail.startDate!) || '…' }} ~ {{ detail.endDate ? formatDate(detail.endDate) : '至今' }}
              </dd>
            </div>
            <div v-if="detail.githubRepo" class="meta-item">
              <dt>仓库</dt>
              <dd>{{ detail.githubRepo }}</dd>
            </div>
          </dl>
          <ul v-if="detail.technologies.length" class="tags" aria-label="技术栈">
            <li v-for="tech in detail.technologies" :key="tech" class="tag">{{ tech }}</li>
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

      <section v-if="detail.description" class="card section" aria-labelledby="desc-title">
        <h2 id="desc-title">项目介绍</h2>
        <div class="markdown" v-html="descriptionHtml" />
      </section>

      <section v-if="detail.note" class="card section" aria-labelledby="note-title">
        <h2 id="note-title">笔记 · {{ detail.note.title }}</h2>
        <div class="markdown" v-html="noteHtml" />
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
