<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getPublicProject } from '@/api/projects'
import ProjectCover from '@/components/ProjectCover.vue'
import ProgressBadge from '@/components/ProgressBadge.vue'
import { LINK_TYPE_LABELS, PROGRESS_LABELS, type Link, type ProjectDetail } from '@/types'
import { bareDomain, safeHttpUrl } from '@/utils/link'
import { renderMarkdown } from '@/utils/markdown'
import { formatDate } from '@/utils/text'

const props = defineProps<{ slug: string }>()
const router = useRouter()

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

/** 只取指定类型的第一条可用链接（用于 hero 主操作按钮）。 */
function primaryLink(type: Link['type']): string | null {
  const link = detail.value?.links.find((l) => l.type === type)
  return link ? safeHttpUrl(link.url) : null
}

/** 失效链接的说明文案（title 与 aria-label 共用）。 */
function failedHint(link: Link): string {
  return link.last_http_status
    ? `链接检查失败（HTTP ${link.last_http_status}），仍可尝试打开`
    : '链接检查失败，仍可尝试打开'
}

/** 链接的可访问名：只在 failed 时补失败说明，其余类型不加噪音。 */
function linkAriaLabel(link: Link): string {
  const base = `${LINK_TYPE_LABELS[link.type]} · ${detail.value?.name ?? ''}（新窗口打开）`
  return link.last_status === 'failed' ? `${base}，${failedHint(link)}` : base
}

/** 首页三个主操作：源码仓库 / 访问官网 / 查看笔记（与右栏「相关链接」清单并存）。 */
const heroActions = computed(() => {
  const item = detail.value
  if (!item) return []
  const actions: Array<{ key: string; label: string; href: string; external: boolean }> = []
  const repo = primaryLink('repo')
  const site = primaryLink('site')
  if (repo) actions.push({ key: 'repo', label: '源码仓库', href: repo, external: true })
  if (site) actions.push({ key: 'site', label: '访问官网', href: site, external: true })
  if (item.notes.length) {
    actions.push({ key: 'notes', label: '查看笔记', href: '#related-notes', external: false })
  }
  return actions
})

/**
 * 元数据 panel 的固定行（空值整行不渲染）。
 *
 * 「发布状态」与「进展」在公开 payload 里只有 progress：公开接口按可见性过滤，
 * 能出现在这里的项目一律是已发布，故发布状态固定渲染「已发布」（见评论中的假设记录）。
 */
const fixedMeta = computed(() => {
  const item = detail.value
  if (!item) return []
  return [
    { label: '发布状态', value: '已发布' },
    { label: '进展', value: PROGRESS_LABELS[item.progress] },
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
    // 旧 slug 被 301 到规范 slug 后，把地址栏也换成规范地址，避免用户复制旧地址分享。
    if (detail.value.slug !== props.slug) {
      await router.replace({ name: 'project-detail', params: { slug: detail.value.slug } })
    }
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
          <p v-if="heroActions.length" class="hero-actions">
            <template v-for="(action, index) in heroActions" :key="action.key">
              <a
                v-if="action.external"
                :href="action.href"
                target="_blank"
                rel="noopener noreferrer"
                class="btn"
                :class="index === 0 ? 'btn-primary' : 'btn-ghost'"
                :aria-label="`${action.label} · ${detail.name}（新窗口打开）`"
                >{{ action.label }}</a
              >
              <a
                v-else
                :href="action.href"
                class="btn btn-ghost"
                :aria-label="`${action.label} · ${detail.name}（跳到本页笔记区）`"
                >{{ action.label }}</a
              >
            </template>
          </p>
        </div>
      </header>

      <div class="body-grid">
        <div class="column-main">
          <section v-if="descriptionHtml" class="card section" aria-labelledby="desc-title">
            <h2 id="desc-title">项目介绍</h2>
            <div class="markdown" v-html="descriptionHtml" />
          </section>

          <section v-if="detail.notes.length" id="related-notes" class="card section" aria-labelledby="notes-title">
            <h2 id="notes-title">相关笔记</h2>
            <ul class="note-list">
              <li v-for="note in detail.notes" :key="note.id" class="note-item">
                <span v-if="note.published_at" class="note-date tabular-nums">{{
                  formatDate(note.published_at)
                }}</span>
                <RouterLink :to="{ name: 'note-detail', params: { slug: note.slug } }" class="note-title">
                  {{ note.title }}
                </RouterLink>
                <p v-if="note.excerpt" class="note-excerpt type-small">{{ note.excerpt }}</p>
                <ul v-if="note.tags.length" class="tags">
                  <li v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</li>
                </ul>
              </li>
            </ul>
            <RouterLink :to="{ name: 'notes' }" class="note-all type-small">全部笔记 →</RouterLink>
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
                <span v-if="!safeHttpUrl(link.url)" class="link-anchor link-anchor--plain">
                  <span class="link-type">{{ LINK_TYPE_LABELS[link.type] }}</span>
                  <span class="link-label">{{ link.label || link.url }}</span>
                  <span class="link-host type-small">链接地址不合法，已停用</span>
                </span>
                <a
                  v-else
                  :href="safeHttpUrl(link.url) ?? undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link-anchor"
                  :class="{ 'link-anchor--failed': link.last_status === 'failed' }"
                  :title="link.last_status === 'failed' ? failedHint(link) : undefined"
                  :aria-label="linkAriaLabel(link)"
                >
                  <span class="link-type">{{ LINK_TYPE_LABELS[link.type] }}</span>
                  <span class="link-label">
                    <span v-if="link.last_status === 'failed'" class="link-warn" aria-hidden="true">⚠</span>
                    {{ link.label || bareDomain(link.url) }}
                  </span>
                  <span class="link-host type-small">
                    {{ bareDomain(link.url) }}
                    <span v-if="link.last_status === 'failed'" class="link-failed">{{ failedHint(link) }}</span>
                  </span>
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
.hero-actions {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
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
/* F9：只对 failed 降级（低对比 + 失效图标 + 文案），ok / unknown / null 一律同款 */
.link-anchor--failed .link-label {
  color: var(--c-text-secondary);
}
.link-anchor--failed .link-type,
.link-anchor--failed .link-host {
  color: var(--c-text-secondary);
  opacity: 0.75;
}
.link-warn {
  margin-right: 4px;
  color: var(--c-danger);
}
.link-failed {
  color: var(--c-danger);
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
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-12);
  border-bottom: 1px solid var(--c-border);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.note-item:last-of-type {
  border-bottom: none;
}
.note-excerpt {
  margin: 0;
  color: var(--c-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.note-all {
  color: var(--c-primary-strong);
  text-decoration: none;
  align-self: flex-start;
}
.note-all:hover {
  text-decoration: underline;
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
