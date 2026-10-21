<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

function onLogout() {
  auth.logout()
  void router.replace({ name: 'admin-login' })
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-title">项目展示平台</span>
        <span class="brand-sub">后台管理</span>
      </div>

      <nav class="nav" aria-label="后台导航">
        <RouterLink class="nav-link" :to="{ name: 'admin-projects' }">项目列表</RouterLink>
        <RouterLink class="nav-link" :to="{ name: 'admin-project-new' }">新建项目</RouterLink>
      </nav>

      <div class="sidebar-footer">
        <button class="btn btn-ghost" type="button" @click="onLogout">退出登录</button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}
.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-2);
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
}
.sidebar-brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 var(--sp-1);
}
.brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--c-ink);
}
.brand-sub {
  font-size: 12px;
  color: var(--c-text-secondary);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-link {
  display: block;
  padding: 10px 12px;
  font-weight: 600;
  color: var(--c-text);
  border-radius: var(--r-control);
}
.nav-link:hover {
  background: var(--c-fill);
  text-decoration: none;
}
.nav-link.router-link-active {
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
}
.sidebar-footer {
  margin-top: auto;
}
.sidebar-footer .btn {
  width: 100%;
  justify-content: center;
}
.content {
  min-width: 0;
  padding: var(--sp-4) var(--sp-3);
}
@media (max-width: 720px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--c-border);
  }
  .nav {
    flex-direction: row;
  }
}
</style>
