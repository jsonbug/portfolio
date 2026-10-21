<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getPublicNote, listPublicNotes } from '@/api/notes'
import { getPublicProject } from '@/api/projects'
import ProgressBadge from '@/components/ProgressBadge.vue'
import { renderMarkdown } from '@/utils/markdown'
import { formatDate, readingTimeMinutes } from '@/utils/text'
import type { NoteDetail, NoteSummary, ProjectDetail } from '@/types'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const note = ref<NoteDetail | null>(null)
const loading = ref(true)
const error = ref('')

/** 右栏「所属项目」卡：笔记只带 slug/name，描述与进展要再取一次项目详情。 */
const project = ref<ProjectDetail | null>(null)

/** 上下篇：在已取的前 100 篇里按 published_at 倒序定位相邻两条。 */
const siblings = ref<NoteSummary[]>([])

const bodyHtml = computed(() => (note.value ? renderMarkdown(note.value.body_md) : ''))
const readMinutes = computed(() => (note.value ? readingTimeMinutes(note.value.body_md) : 0))

const bodyEl = ref<HTMLElement | null>(null)
/** 正文标题：切换笔记后把焦点交过来（读屏从这里开始念）。 */
const titleEl = ref<HTMLElement | null>(null)
const toc = ref<{ id: string; text: string; level: number }[]>([])
/** 目录当前项：滚动时高亮（左侧 2px 主色竖条）。 */
const activeId = ref('')

const index = computed(() => siblings.value.findIndex((item) => item.slug === note.value?.slug))
/** 当前笔记不在「最近 100 篇」里：上下篇无法定位，明说而不是静默不渲染。 */
const outsideRecent = computed(() => index.value === -1 && siblings.value.length > 0)
const prev = computed(() => (index.value > 0 ? siblings.value[index.value - 1] : null))
const next = computed(() =>
  index.value >= 0 && index.value < siblings.value.length - 1 ? siblings.value[index.value + 1] : null,
)

/** 渲染完成后给 h2/h3 补 id，目录锚点因此与正文一一对应。 */
async function buildToc(): Promise<void> {
  await nextTick()
  const root = bodyEl.value
  if (!root) {
    toc.value = []
    return
  }
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('h2, h3'))
  toc.value = nodes.map((node, i) => {
    const id = node.id || `heading-${i + 1}`
    node.id = id
    // 锚点跳转后目标可聚焦，键盘用户不会「跳过去但焦点还留在目录里」。
    node.tabIndex = -1
    return { id, text: node.textContent?.trim() ?? '', level: Number(node.tagName.slice(1)) }
  })
}

/** 取正文标题里「最后一个已经滚过顶部的」，作为目录当前项。 */
function syncActiveHeading(): void {
  const root = bodyEl.value
  if (!root) return
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('h2, h3'))
  // 120px ≈ 吸顶留白；没有任何标题滚过时高亮第一条，避免目录「没有当前项」。
  let current = nodes[0]?.id ?? ''
  for (const node of nodes) {
    if (node.getBoundingClientRect().top <= 120) current = node.id
    else break
  }
  activeId.value = current
}

async function load(slug: string): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    note.value = await getPublicNote(slug)
    // 旧 slug 被 301 到规范 slug 后收敛地址栏，别人复制到的是新地址。
    if (note.value.slug !== slug) {
      await router.replace({ name: 'note-detail', params: { slug: note.value.slug } })
    }
    await nextTick()
    titleEl.value?.focus()
    void getPublicProject(note.value.project.slug)
      .then((detail) => {
        project.value = detail
      })
      .catch(() => {
        // 项目不可见（下架/软删）时右栏只显示名称，不影响正文阅读。
        project.value = null
      })
    syncActiveHeading()
  } catch (e) {
    note.value = null
    toc.value = []
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

// 正文用 v-html 渲染，只有 note 落定、loading 变 false 之后 DOM 里才有 h2/h3。
watch(
  () => [note.value?.body_md, loading.value] as const,
  () => {
    if (note.value && !loading.value) void buildToc()
  },
  { flush: 'post' },
)

onMounted(async () => {
  window.addEventListener('scroll', syncActiveHeading, { passive: true })
  window.addEventListener('resize', syncActiveHeading, { passive: true })
  void load(props.slug)
  try {
    const res = await listPublicNotes({ page: 1, pageSize: 100 })
    siblings.value = res.items
  } catch {
    siblings.value = []
  }
})

watch(
  () => props.slug,
  (slug) => void load(slug),
)

onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncActiveHeading)
  window.removeEventListener('resize', syncActiveHeading)
})
</script>

<template>
  <main class="page note-detail">
    <nav class="back">
      <RouterLink :to="{ name: 'notes' }">← 全部笔记</RouterLink>
    </nav>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>

    <template v-else-if="note">
      <header class="head">
        <h1 ref="titleEl" class="type-h1" tabindex="-1">{{ note.title }}</h1>
        <p class="meta type-small">
          <RouterLink :to="{ name: 'project-detail', params: { slug: note.project.slug } }" class="project-link">
            {{ note.project.name }}
          </RouterLink>
          <span aria-hidden="true">·</span>
          <span class="tabular-nums">{{ formatDate(note.published_at ?? note.updated_at) }}</span>
          <span aria-hidden="true">·</span>
          <span>约 {{ readMinutes }} 分钟</span>
        </p>
        <ul v-if="note.tags.length" class="tags" aria-label="标签">
          <li v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</li>
        </ul>
      </header>

      <div class="layout">
        <article class="card article">
          <div ref="bodyEl" class="markdown" v-html="bodyHtml" />
        </article>

        <aside class="side" aria-live="polite">
          <section v-if="toc.length" class="card panel" aria-labelledby="toc-title">
            <h2 id="toc-title" class="panel-title type-small">本页目录</h2>
            <ul class="toc">
              <li v-for="item in toc" :key="item.id" :class="`toc-${item.level}`">
                <a
                  :href="`#${item.id}`"
                  :aria-current="item.id === activeId ? 'location' : undefined"
                >
                  {{ item.text }}
                </a>
              </li>
            </ul>
          </section>

          <section class="card panel" aria-labelledby="project-title">
            <h2 id="project-title" class="panel-title type-small">所属项目</h2>
            <RouterLink :to="{ name: 'project-detail', params: { slug: note.project.slug } }" class="project-card">
              <span class="project-head">
                <span class="project-name">{{ note.project.name }}</span>
                <ProgressBadge v-if="project" :progress="project.progress" />
              </span>
              <span v-if="project?.summary" class="project-summary type-small">{{
                project.summary
              }}</span>
              <span class="type-mono project-slug">{{ note.project.slug }}</span>
            </RouterLink>
          </section>
        </aside>
      </div>

      <p v-if="outsideRecent" class="siblings-hint type-small">
        这篇笔记较早，未在最近 100 篇内，上下篇不可用。
        <RouterLink :to="{ name: 'notes' }">回笔记列表</RouterLink>
      </p>
      <nav v-if="prev || next" class="siblings" aria-label="上下篇">
        <RouterLink v-if="prev" :to="{ name: 'note-detail', params: { slug: prev.slug } }" class="sibling">
          <span class="type-mono sibling-label">← 上一篇</span>
          <span class="sibling-title">{{ prev.title }}</span>
        </RouterLink>
        <RouterLink v-if="next" :to="{ name: 'note-detail', params: { slug: next.slug } }" class="sibling sibling--next">
          <span class="type-mono sibling-label">下一篇 →</span>
          <span class="sibling-title">{{ next.title }}</span>
        </RouterLink>
      </nav>
    </template>
  </main>
</template>

<style scoped>
.note-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
}
.back {
  font-size: var(--fs-small);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}
.head h1 {
  margin: 0;
  color: var(--c-ink);
}
.meta {
  margin: 0;
  display: flex;
  gap: var(--space-8);
  align-items: center;
  color: var(--c-text-secondary);
  flex-wrap: wrap;
}
.project-link {
  color: var(--c-primary-strong);
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
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1;
  color: var(--c-text);
  background: var(--c-fill);
  border-radius: var(--r-tag);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: var(--space-24);
  align-items: start;
}
@media (max-width: 1023px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.article {
  padding: var(--space-32);
  min-width: 0;
}
.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  position: sticky;
  top: var(--space-24);
}
.panel {
  padding: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.panel-title {
  margin: 0;
  color: var(--c-text-secondary);
  font-weight: var(--fw-semibold);
}
.toc {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.toc a {
  color: var(--c-text);
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  text-decoration: none;
  /* 当前项：2px 主色竖条（走查 #20），非当前项保留同宽透明条避免文字跳动 */
  display: block;
  padding-left: var(--space-8);
  border-left: 2px solid transparent;
}
.toc a[aria-current] {
  color: var(--c-primary-strong);
  border-left-color: var(--c-primary);
  font-weight: var(--fw-semibold);
}
.toc a:hover {
  color: var(--c-primary-strong);
}
.toc-3 {
  padding-left: var(--space-12);
}
.project-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-8);
  min-height: var(--touch-min);
  justify-content: center;
  border-radius: var(--r-control);
  text-decoration: none;
}
.project-card:hover {
  background: var(--c-fill);
}
.project-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}
.project-name {
  color: var(--c-primary-strong);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.project-summary {
  color: var(--c-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-slug {
  color: var(--c-text-secondary);
}
.siblings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-16);
}
.sibling {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-16);
  min-height: var(--touch-min);
  text-decoration: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  color: var(--c-text);
}
.sibling:hover {
  border-color: var(--c-control-border);
  background: var(--c-fill);
}
.sibling--next {
  text-align: right;
}
.sibling-label {
  color: var(--c-text-secondary);
}
.sibling-title {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.hint {
  margin: 0;
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
  margin: var(--space-24) 0 var(--space-8);
  scroll-margin-top: 80px;
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
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 var(--space-12);
  padding-left: 1.5em;
}
.markdown :deep(pre) {
  overflow: auto;
  /* 走查 #17：代码块深色（正文浅底上唯一的一块暗面，用来分隔代码与叙述） */
  background: var(--c-code-bg);
  color: var(--c-code-text);
  border-radius: var(--r-control);
  padding: var(--space-16);
  margin: 0 0 var(--space-12);
}
.markdown :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
.markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--fs-mono);
  background: var(--c-fill);
  border-radius: var(--r-tag);
  padding: 1px 6px;
}
.markdown :deep(a) {
  color: var(--c-primary);
}
.markdown :deep(blockquote) {
  /* 走查 #18：陶土红竖条 + 桃色底 + 小标签 */
  position: relative;
  margin: 0 0 var(--space-12);
  padding: var(--space-12) var(--space-16) var(--space-12) var(--space-16);
  border-left: 3px solid var(--c-accent);
  border-radius: 0 var(--r-control) var(--r-control) 0;
  background: var(--c-accent-soft);
  color: var(--c-text);
}
.markdown :deep(blockquote)::before {
  content: '备注';
  display: block;
  margin-bottom: 2px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--c-accent);
}
.markdown :deep(blockquote p:last-child) {
  margin-bottom: 0;
}
.siblings-hint {
  margin: 0;
  color: var(--c-text-secondary);
}
.siblings-hint a {
  color: var(--c-primary-strong);
}
</style>
