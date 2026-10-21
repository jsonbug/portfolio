<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listPublicProjects } from '@/api/projects'
import ProjectCover from '@/components/ProjectCover.vue'
import type { ProjectListItem } from '@/types'
import { formatDate } from '@/utils/text'

const items = ref<ProjectListItem[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await listPublicProjects({ page: 1, pageSize: 100 })
    items.value = res.items
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <main class="page home">
    <header class="home-header">
      <h1>项目展示平台</h1>
      <p class="subtitle">我做过的项目，附笔记与元数据。</p>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="!items.length" class="hint">暂无已发布项目。</p>

    <ul v-else class="grid">
      <li v-for="item in items" :key="item.id">
        <RouterLink class="card project-card" :to="{ name: 'project-detail', params: { id: item.id } }">
          <ProjectCover :name="item.name" :cover-image="item.coverImage" variant="card" />
          <div class="card-body">
            <h2 class="project-name">{{ item.name }}</h2>
            <p v-if="item.tagline" class="project-tagline">{{ item.tagline }}</p>
            <div class="project-meta">
              <span v-if="item.technologies.length" class="tags">
                <span v-for="tech in item.technologies" :key="tech" class="tag">{{ tech }}</span>
              </span>
              <span class="meta">
                <span v-if="item.stars != null">★ {{ item.stars }}</span>
                <span>{{ formatDate(item.lastActivityAt ?? item.updatedAt) }}</span>
              </span>
            </div>
          </div>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.home {
  max-width: 72rem;
}
.home-header {
  margin-bottom: var(--sp-3);
}
.home-header h1 {
  margin: 0;
  font-size: 28px;
  color: var(--c-ink);
}
.subtitle {
  margin: var(--sp-1) 0 0;
  font-size: 13px;
  color: var(--c-text-secondary);
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
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--sp-3);
}
.project-card {
  display: block;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s;
}
.project-card:hover {
  text-decoration: none;
  box-shadow: 0 4px 16px rgba(20, 17, 13, 0.08);
}
.card-body {
  padding: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.project-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--c-ink);
}
.project-tagline {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-secondary);
}
.project-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.tags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tag {
  padding: 1px 8px;
  font-size: 12px;
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
  border-radius: var(--r-tag);
}
.meta {
  display: inline-flex;
  gap: var(--sp-2);
  font-size: 12px;
  color: var(--c-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
