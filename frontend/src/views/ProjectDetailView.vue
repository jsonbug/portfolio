<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getPublicProject } from '@/api/projects'
import AppBadge from '@/components/AppBadge.vue'
import LinkTypeIcon from '@/components/LinkTypeIcon.vue'
import ProgressBadge from '@/components/ProgressBadge.vue'
import { METRIC_LIMITS } from '@/constants/limits'
import {
  LINK_TYPE_LABELS,
  PROGRESS_LABELS,
  type Link,
  type ProjectDetail,
  type Screenshot,
} from '@/types'
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
 * 元数据 panel 的固定行（空值整行不渲染，走查 #13 的顺序）。
 *
 * 「发布状态」与「进展」拆成两行、各一个徽标（02 稿 + D6「两个维度同屏时上下堆叠、不并排」）。
 * 上一轮曾合并成一行「状态」并置两个徽标，按稿撤回。
 *
 * 公开 payload 里只有 `progress`：能出现在这里的项目一律已发布，
 * 故发布状态固定为「已发布」（见交付评论里的假设记录）。
 */
/** 有笔记入口时主按钮给「查看笔记」（02 稿：三入口里只有它是主色），否则第一个外部入口当主按钮。 */
const hasNotesAction = computed(() => heroActions.value.some((action) => action.key === 'notes'))

const fixedMeta = computed(() => {
  const item = detail.value
  if (!item) return []
  return [
    { label: '发布状态', value: '已发布', badge: 'published' as const },
    { label: '进展', value: PROGRESS_LABELS[item.progress], badge: 'progress' as const },
    {
      label: '起始年份',
      value: item.start_year != null ? String(item.start_year) : '',
      badge: null,
    },
    { label: '我的角色', value: item.role ?? '', badge: null },
    { label: '团队规模', value: item.team_size != null ? `${item.team_size} 人` : '', badge: null },
    { label: '开源协议', value: item.license ?? '', badge: null },
  ].filter((row) => row.value !== '')
})

/**
 * 右栏元数据 panel 只放 `kind === 'meta'` 的条目；
 * `kind === 'metric'` 的条目属于左栏「指标」统计格（契约 4.1.1），两边不能重复渲染。
 */
const metaRows = computed(() => (detail.value?.metadata ?? []).filter((row) => row.kind !== 'metric'))

/** 「状态」行里的进展徽标：与 ProgressBadge 同一套形状/色调（形状+文字双编码）。 */
const progressTone = computed(() => (detail.value?.progress === 'launched' ? 'success' : 'warning'))
const progressShape = computed(() => (detail.value?.progress === 'launched' ? 'check' : 'half'))

/** 指标统计格：最多 4 格，0 条时整块不渲染（稿上 4 格是上限，不是要求凑满）。 */
const metricCells = computed(() =>
  (detail.value?.metadata ?? []).filter((row) => row.kind === 'metric').slice(0, METRIC_LIMITS.max),
)

/**
 * 截图轮播（稿：一次一张 + 左右箭头 + `截图 n/N` + 图注）。
 *
 * 过不了 `safeHttpUrl` 的地址整项不渲染（沿用详情页链接的处理口径）：
 * 渲染出来只会是一张裂图，比少一张更糟。
 */
const shots = computed<Array<Screenshot & { safeUrl: string }>>(() =>
  (detail.value?.screenshots ?? []).flatMap((shot) => {
    const safeUrl = safeHttpUrl(shot.url)
    return safeUrl ? [{ ...shot, safeUrl }] : []
  }),
)

const shotIndex = ref(0)
const currentShot = computed(() => shots.value[shotIndex.value] ?? null)

function stepShot(delta: number): void {
  const total = shots.value.length
  if (total <= 1) return
  shotIndex.value = (shotIndex.value + delta + total) % total
}

/** 有图注用图注，没有则「{项目名} 截图 n」——alt 不能为空，也不能只是文件名。 */
function shotAlt(shot: Screenshot, index: number): string {
  return shot.caption?.trim() || `${detail.value?.name ?? '项目'} 截图 ${index + 1}`
}

const hasMetaPanel = computed(() => fixedMeta.value.length > 0 || metaRows.value.length > 0)
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
    <nav class="back" aria-label="面包屑">
      <span class="crumb">
      <RouterLink :to="{ name: 'home' }">项目</RouterLink>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <span v-if="detail" class="crumb-current" aria-current="page">{{ detail.name }}</span>
      </span>
      <span v-if="detail" class="updated type-small">
        更新于 {{ formatDate(detail.last_updated_at ?? detail.updated_at) }}
      </span>
    </nav>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <template v-else-if="detail">
      <header class="hero">
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
                :class="index === 0 && !hasNotesAction ? 'btn-primary' : 'btn-ghost'"
                :aria-label="`${action.label} · ${detail.name}（新窗口打开）`"
                >{{ action.label }}</a
              >
              <a
                v-else
                :href="action.href"
                class="btn"
                :class="index === heroActions.length - 1 ? 'btn-primary' : 'btn-ghost'"
                :aria-label="`${action.label} · ${detail.name}（跳到本页笔记区）`"
                >{{ action.label }}</a
              >
            </template>
          </p>
        </div>
      </header>

      <div class="body-grid">
        <div class="column-main">
          <section
            v-if="descriptionHtml || currentShot"
            class="card section"
            aria-labelledby="desc-title"
          >
            <h2 id="desc-title">项目简介</h2>
            <div v-if="descriptionHtml" class="markdown" v-html="descriptionHtml" />

            <figure
              v-if="currentShot"
              class="shot"
              role="group"
              aria-roledescription="轮播"
              aria-label="项目截图"
            >
              <img
                :src="currentShot.safeUrl"
                :alt="shotAlt(currentShot, shotIndex)"
                class="shot-image"
                :loading="shotIndex === 0 ? 'eager' : 'lazy'"
                decoding="async"
              />
              <figcaption class="shot-bar">
                <span class="shot-caption type-small">{{ currentShot.caption ?? '' }}</span>
                <span class="shot-nav">
                  <button
                    v-if="shots.length > 1"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    aria-label="上一张截图"
                    @click="stepShot(-1)"
                  >
                    ‹
                  </button>
                  <span class="shot-count type-small tabular-nums" aria-live="polite">
                    截图 {{ shotIndex + 1 }} / {{ shots.length }}
                  </span>
                  <button
                    v-if="shots.length > 1"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    aria-label="下一张截图"
                    @click="stepShot(1)"
                  >
                    ›
                  </button>
                </span>
              </figcaption>
            </figure>

          </section>

          <!-- 02 稿：指标条是「项目简介」卡下面独立的一条，只吃 kind === 'metric' -->
          <ul v-if="metricCells.length" class="card metric-bar" aria-label="关键指标">
            <li v-for="cell in metricCells" :key="cell.key_label" class="metric-cell">
              <strong class="metric-value tabular-nums">{{ cell.value }}</strong>
              <span class="metric-label type-small">{{ cell.key_label }}</span>
            </li>
          </ul>

          <section v-if="detail.notes.length" id="related-notes" class="card section" aria-labelledby="notes-title">
            <div class="section-head">
              <h2 id="notes-title">相关笔记</h2>
              <span class="count type-small tabular-nums">{{ detail.notes.length }} 篇</span>
            </div>
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
            <div class="section-head">
              <h2 id="meta-title">元数据</h2>
              <span class="count type-small tabular-nums">
                {{ fixedMeta.length }} 固定<template v-if="metaRows.length">
                  · {{ metaRows.length }} 追加</template
                >
              </span>
            </div>
            <dl class="kv">
              <div v-for="row in fixedMeta" :key="row.label" class="kv-row">
                <dt>{{ row.label }}</dt>
                <dd v-if="row.badge === 'published'" class="kv-badges">
                  <AppBadge tone="published" shape="dot">已发布</AppBadge>
                </dd>
                <dd v-else-if="row.badge === 'progress'" class="kv-badges">
                  <AppBadge :tone="progressTone" :shape="progressShape">
                    {{ row.value }}
                  </AppBadge>
                </dd>
                <dd v-else>{{ row.value }}</dd>
              </div>
              <div v-for="row in metaRows" :key="`kv-${row.key_label}`" class="kv-row">
                <dt>{{ row.key_label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="detail.links.length" class="card section panel" aria-labelledby="links-title">
            <div class="section-head">
              <h2 id="links-title">相关链接</h2>
              <span class="count type-small tabular-nums">{{ detail.links.length }}</span>
            </div>
            <ul class="links">
              <li v-for="link in detail.links" :key="link.id" class="link">
                <span v-if="!safeHttpUrl(link.url)" class="link-anchor link-anchor--plain">
                  <span class="link-type" aria-hidden="true"><LinkTypeIcon :type="link.type" /></span>
                  <span class="link-label">{{ link.label || LINK_TYPE_LABELS[link.type] }}</span>
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
                  <span class="link-type" aria-hidden="true">
                    <LinkTypeIcon :type="link.type" />
                  </span>
                  <span class="link-label">
                    <span v-if="link.last_status === 'failed'" class="link-warn" aria-hidden="true">⚠</span>
                    {{ link.label || LINK_TYPE_LABELS[link.type] }}
                  </span>
                  <span class="link-host type-small">
                    {{ bareDomain(link.url) }}
                    <span v-if="link.last_status === 'failed'" class="link-failed">{{ failedHint(link) }}</span>
                  </span>
                  <span class="link-chevron" aria-hidden="true">›</span>
                </a>
              </li>
            </ul>
          </section>

          <section v-if="detail.tech_stack.length" class="card section panel" aria-labelledby="tech-title">
            <div class="section-head">
              <h2 id="tech-title">技术栈</h2>
              <span class="count type-small tabular-nums">{{ detail.tech_stack.length }}</span>
            </div>
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
.crumb-sep {
  color: var(--c-text-secondary);
}

.crumb-current {
  color: var(--c-ink);
}

.updated {
  margin-left: auto;
  color: var(--c-text-secondary);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
}

.section-head .count {
  color: var(--c-text-secondary);
}

.back {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
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
  /* 走查 #12：区块标题 22/32 600，不再用 17/26 */
  font-size: var(--fs-h2);
  line-height: var(--lh-h2);
  font-weight: var(--fw-semibold);
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
.link-chevron {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--c-text-secondary);
}
.link-anchor {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
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
  grid-row: 1 / span 2;
  align-self: center;
  display: inline-flex;
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
.shot {
  margin: var(--space-24) 0 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--c-fill);
}

.shot-image {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: var(--c-fill);
}

.shot-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
}

.shot-caption {
  color: var(--c-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shot-nav {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--c-text-secondary);
  flex: none;
}

/* 4 格指标：稿上是等分格 + 左侧发丝线，窄屏折成 2 列 */
.metric-bar {
  display: grid;
  /* 2 条就均分两格、4 条就四格：不为了「凑四格」往里塞 stars/version（口径差异 #5） */
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.metric-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-16);
  border-left: 1px solid var(--c-border);
}

.metric-cell:first-child {
  border-left: none;
}

.metric-value {
  font-size: var(--fs-h2);
  line-height: var(--lh-h2);
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
}

.metric-label {
  color: var(--c-text-secondary);
}

@media (max-width: 767px) {
  .metric-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-cell:nth-child(odd) {
    border-left: none;
  }

  .metric-cell:nth-child(n + 3) {
    border-top: 1px solid var(--c-border);
  }
}

.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
}
.kv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  min-height: 44px;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  /* 行间 1px 虚线（走查 #13） */
  border-bottom: 1px dashed var(--c-border);
}
.kv-row:last-child {
  border-bottom: 0;
}
.kv-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  /* 走查 #14：灰底灰字，与卡片标签同款（原来是主色浅底 + 主色字，蓝成一片） */
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1;
  color: var(--c-text);
  background: var(--c-fill);
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
