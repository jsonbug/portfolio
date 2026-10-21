<script setup lang="ts">
/**
 * 前台一级导航：品牌 / 项目 / 笔记 + 顶栏搜索 + 后台入口 + 头像。
 *
 * 搜索框只做「提交后跳到列表并把词写进 `?q=`」，真正的筛选真源在 HomeView 的 URL query，
 * 这样刷新、分享、前进后退都拿到一致的结果（与批甲的做法一致）。
 */
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clampSearch } from '@/utils/text'

const route = useRoute()
const router = useRouter()

const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')

// 从别处（清空筛选、后退）回到列表时，输入框跟着 URL 走。
watch(
  () => route.query.q,
  (value) => {
    keyword.value = typeof value === 'string' ? value : ''
  },
)

/** 头像：个人站固定一个字母组合，不接用户体系（后台只有站长一个账号）。 */
const initials = 'DS'

function submit(): void {
  const q = clampSearch(keyword.value).trim()
  void router.push({ name: 'home', query: q ? { q } : {} })
}
</script>

<template>
  <header class="site-header">
    <div class="site-header-inner">
      <div class="header-left">
        <RouterLink :to="{ name: 'home' }" class="brand">项目展示平台</RouterLink>
        <nav class="site-nav" aria-label="主导航">
          <RouterLink :to="{ name: 'home' }" class="nav-link" active-class="nav-link--active"
            >项目</RouterLink
          >
          <RouterLink :to="{ name: 'notes' }" class="nav-link" active-class="nav-link--active"
            >笔记</RouterLink
          >
        </nav>
      </div>

      <div class="header-right">
        <form class="header-search" role="search" @submit.prevent="submit">
          <svg class="search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <input
            v-model="keyword"
            class="search-field"
            type="search"
            aria-label="搜索项目"
            placeholder="搜索项目…"
            :maxlength="200"
          />
        </form>

        <RouterLink :to="{ name: 'admin-projects' }" class="admin-entry">后台管理</RouterLink>

        <span class="avatar" :aria-label="`已登录：站长（${initials}）`" role="img">{{ initials }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.site-header-inner {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--gutter);
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-24);
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-16);
}
.header-left {
  gap: var(--space-24);
}
.brand {
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
  text-decoration: none;
  white-space: nowrap;
}
.site-nav {
  display: flex;
  gap: var(--space-4);
}
.nav-link {
  min-height: var(--touch-min);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-12);
  border-radius: var(--r-control);
  font-size: var(--fs-body);
  color: var(--c-text-secondary);
  text-decoration: none;
}
.nav-link:hover {
  background: var(--c-fill);
  color: var(--c-text);
}
.nav-link--active {
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
}
.nav-link:focus-visible,
.admin-entry:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.header-search {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  height: var(--control-h);
  padding: 0 var(--space-12);
  border: 1px solid var(--c-control-border);
  border-radius: var(--r-control);
  background: var(--c-surface);
  /* 01/03 稿：顶栏搜索是固定宽度的一条，不要抢导航的位置 */
  width: 220px;
}
.search-icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--c-text-secondary);
}
.search-field {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-small);
  color: var(--c-ink);
}
.search-field::placeholder {
  color: var(--c-text-secondary);
}
.admin-entry {
  min-height: var(--touch-min);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-12);
  border: 1px solid var(--c-control-border);
  border-radius: var(--r-control);
  font-size: var(--fs-small);
  color: var(--c-text);
  text-decoration: none;
  white-space: nowrap;
}
.admin-entry:hover {
  background: var(--c-fill);
}
.avatar {
  width: 32px;
  height: 32px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-pill);
  background: var(--c-fill);
  color: var(--c-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.02em;
}
@media (max-width: 899px) {
  .header-search {
    width: 140px;
  }
  .admin-entry {
    display: none;
  }
}
</style>
