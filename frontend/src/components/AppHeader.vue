<script setup lang="ts">
/** 前台一级导航（项目 / 笔记）。后台走 AdminLayout 自己的侧栏。 */
</script>

<template>
  <header class="site-header">
    <div class="site-header-inner">
      <RouterLink :to="{ name: 'home' }" class="brand">项目展示平台</RouterLink>
      <nav class="site-nav" aria-label="主导航">
        <RouterLink :to="{ name: 'home' }" class="nav-link" active-class="nav-link--active">项目</RouterLink>
        <RouterLink :to="{ name: 'notes' }" class="nav-link" active-class="nav-link--active">笔记</RouterLink>
      </nav>
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
.brand {
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
  text-decoration: none;
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
.nav-link:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
</style>
