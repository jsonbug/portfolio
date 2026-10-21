<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ProgressBadge from './ProgressBadge.vue'
import ProjectCover from './ProjectCover.vue'
import { safeHttpUrl } from '@/utils/link'
import { formatDate } from '@/utils/text'
import type { ProjectListItem } from '@/types'

/**
 * 前台项目卡片：封面 + 名称 + 进展徽标 + 摘要（2 行截断）+ 技术栈 + 指标 + 仓库/官网双入口。
 * 卡片主体是一个链接（详情页），外部入口放在主体之外，避免嵌套可交互元素。
 */
const props = defineProps<{ item: ProjectListItem }>()

const repoLink = computed(() => {
  const link = props.item.links.find((item) => item.type === 'repo')
  const url = safeHttpUrl(link?.url)
  return link && url ? { ...link, url } : null
})
const siteLink = computed(() => {
  const link = props.item.links.find((item) => item.type === 'site')
  const url = safeHttpUrl(link?.url)
  return link && url ? { ...link, url } : null
})
/** 卡片标题的 id 供卡片链接用 aria-labelledby 指过来（摘要仍留在可访问名里）。 */
const titleId = computed(() => `project-card-title-${props.item.id}`)
/** 手填的 last_updated_at 优先，没有则退回记录更新时间。 */
const updatedAt = computed(() => props.item.last_updated_at ?? props.item.updated_at)
const updatedText = computed(() => formatDate(updatedAt.value))
</script>

<template>
  <article class="card project-card">
    <RouterLink
      class="card-hit"
      :to="{ name: 'project-detail', params: { slug: item.slug } }"
      :aria-labelledby="titleId"
    >
      <ProjectCover :name="item.name" :cover-image="item.cover_image_url" variant="card" />
      <div class="card-body">
        <div class="card-head">
          <h2 :id="titleId" class="card-name">{{ item.name }}</h2>
          <ProgressBadge :progress="item.progress" />
        </div>
        <p v-if="item.summary" class="card-summary">{{ item.summary }}</p>
        <ul v-if="item.tech_stack.length" class="card-tags">
          <li v-for="tech in item.tech_stack" :key="tech" class="tag">{{ tech }}</li>
        </ul>
        <p class="card-meta tabular-nums">
          <span v-if="item.stars != null" class="card-stars">★ {{ item.stars }}</span>
          <span v-if="updatedText" class="card-updated">{{ updatedText }} 更新</span>
        </p>
      </div>
    </RouterLink>

    <div v-if="repoLink || siteLink" class="card-links">
      <a
        v-if="repoLink"
        class="card-link"
        :href="repoLink.url"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`仓库 · ${item.name}（新窗口打开）`"
        >仓库<span class="card-link-mark" aria-hidden="true">↗</span></a
      >
      <a
        v-if="siteLink"
        class="card-link"
        :href="siteLink.url"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`官网 · ${item.name}（新窗口打开）`"
        >官网<span class="card-link-mark" aria-hidden="true">↗</span></a
      >
    </div>
  </article>
</template>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition:
    box-shadow 0.15s,
    transform 0.15s;
}
.project-card:hover {
  box-shadow: var(--shadow-e2);
}
.card-hit {
  display: block;
  text-decoration: none;
  color: inherit;
  flex: 1;
}
.card-hit:hover {
  text-decoration: none;
}
.card-hit:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: -2px;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-16) var(--space-16) var(--space-12);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}
.card-name {
  margin: 0;
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.01em;
  color: var(--c-ink);
}
.card-summary {
  margin: 0;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
  /* 摘要固定 2 行，保证卡片等高 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag {
  padding: 2px var(--space-8);
  border-radius: var(--r-tag);
  background: var(--c-fill);
  color: var(--c-text-secondary);
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
}
.card-meta {
  display: flex;
  gap: var(--space-8);
  margin: 0;
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
  color: var(--c-text-secondary);
}
.card-links {
  display: flex;
  gap: var(--space-8);
  padding: 0 var(--space-16) var(--space-12);
}
.card-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 32px;
  padding: 0 var(--space-8);
  border: 1px solid var(--c-border);
  border-radius: var(--r-control);
  font-size: var(--fs-mono);
  color: var(--c-text);
  text-decoration: none;
}
.card-link:hover {
  border-color: var(--c-control-border);
  background: var(--c-fill);
  text-decoration: none;
}
.card-link-mark {
  color: var(--c-text-secondary);
}
</style>
