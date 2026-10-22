<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ProgressBadge from './ProgressBadge.vue'
import ProjectCover from './ProjectCover.vue'
import LinkTypeIcon from './LinkTypeIcon.vue'
import { safeHttpUrl } from '@/utils/link'
import { formatRelativeDay } from '@/utils/text'
import { LINK_TYPE_LABELS, type Link, type ProjectListItem } from '@/types'

/**
 * 前台项目卡片（设计稿 01/10）：封面 + 名称 + 进展徽标 + 摘要（2 行截断）+ 技术栈，
 * 底栏 1px 分隔线之下是「★ N · 相对时间」与两个图标入口（仓库 / 官网）。
 * 卡片主体是一个链接（详情页），外部入口放在主体之外，避免嵌套可交互元素。
 */
const props = defineProps<{ item: ProjectListItem }>()

function pickLink(type: Link['type']): { link: Link; url: string } | null {
  const link = props.item.links.find((candidate) => candidate.type === type)
  const url = safeHttpUrl(link?.url)
  return link && url ? { link, url } : null
}

const repoLink = computed(() => pickLink('repo'))
const siteLink = computed(() => pickLink('site'))
/** 卡片标题的 id 供卡片链接用 aria-labelledby 指过来（摘要仍留在可访问名里）。 */
const titleId = computed(() => `project-card-title-${props.item.id}`)
/** F9：只有 failed 才降级展示（低对比 + 失效图标 + 说明），ok / unknown / null 一律同款。 */
function isFailed(link: Link | null): boolean {
  return link?.last_status === 'failed'
}

/** 手填的 last_updated_at 优先，没有则退回记录更新时间。 */
const updatedAt = computed(() => props.item.last_updated_at ?? props.item.updated_at)
const updatedText = computed(() => formatRelativeDay(updatedAt.value))
const metaText = computed(() => {
  const parts: string[] = []
  if (props.item.stars != null) parts.push(`★ ${props.item.stars}`)
  if (updatedText.value) parts.push(updatedText.value)
  return parts.join(' · ')
})

const entries = computed(() =>
  [
    { key: 'repo' as const, value: repoLink.value },
    { key: 'site' as const, value: siteLink.value },
  ].filter((entry): entry is { key: 'repo' | 'site'; value: { link: Link; url: string } } =>
    Boolean(entry.value),
  ),
)
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
      </div>
    </RouterLink>

    <div class="card-foot">
      <p class="card-meta tabular-nums">{{ metaText }}</p>
      <div v-if="entries.length" class="card-links">
        <a
          v-for="entry in entries"
          :key="entry.key"
          class="card-icon-btn"
          :class="{ 'card-icon-btn--failed': isFailed(entry.value.link) }"
          :href="entry.value.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="isFailed(entry.value.link) ? '链接检查失败，仍可尝试打开' : LINK_TYPE_LABELS[entry.key]"
          :aria-label="
            isFailed(entry.value.link)
              ? `${LINK_TYPE_LABELS[entry.key]} · ${item.name}（新窗口打开，链接检查失败）`
              : `${LINK_TYPE_LABELS[entry.key]} · ${item.name}（新窗口打开）`
          "
        >
          <LinkTypeIcon :type="entry.key" />
          <span v-if="isFailed(entry.value.link)" class="card-icon-mark" aria-hidden="true">⚠</span>
        </a>
      </div>
    </div>
  </article>
</template>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  /* 同一行卡片等高：摘要有无都不该让底栏错位 */
  width: 100%;
  height: 100%;
  overflow: hidden;
  transition:
    box-shadow 0.15s ease,
    transform 0.15s ease;
}
/* 走查 #28：悬停 e1 → e2 且上移 2px（只换阴影像「没反应」） */
.project-card:hover {
  box-shadow: var(--shadow-e2);
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .project-card {
    transition: none;
  }
  .project-card:hover {
    transform: none;
  }
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
  /* 走查 #27：16 18 14 */
  padding: 16px 18px 14px;
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
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 走查 #27：标签高 26、gap 6、等宽 11.5 */
.tag {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-tag);
  background: var(--c-fill);
  color: var(--c-text);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1;
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: 10px 18px;
  border-top: 1px solid var(--c-border);
}
.card-meta {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
  color: var(--c-text-secondary);
}
.card-links {
  display: flex;
  gap: var(--space-4);
}
/* 视觉 28px、热区 40px（走查 #4） */
.card-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: -6px -4px -6px 0;
  border-radius: var(--r-control);
  color: var(--c-text);
}
.card-icon-btn::before {
  content: '';
  position: absolute;
  width: 28px;
  height: 28px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-control);
  transition: background-color 0.15s ease;
}
.card-icon-btn:hover::before {
  background: var(--c-fill);
  border-color: var(--c-control-border);
}
.card-icon-btn:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: -6px;
}
.card-icon-btn--failed {
  color: var(--c-text-secondary);
}
.card-icon-mark {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  line-height: 1;
}
</style>
