<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/admin/projects'
    await router.replace(redirect)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login">
    <div class="card login-card">
      <header class="login-header">
        <h1>项目展示平台 · 后台</h1>
        <p>登录后管理项目、元数据、链接与笔记。</p>
      </header>

      <form class="login-form" novalidate @submit.prevent="onSubmit">
        <div class="field">
          <label class="field-label" for="username">用户名</label>
          <input
            id="username"
            v-model="username"
            class="input"
            name="username"
            type="text"
            autocomplete="username"
            required
            :disabled="loading"
          />
        </div>

        <div class="field">
          <label class="field-label" for="password">密码</label>
          <input
            id="password"
            v-model="password"
            class="input"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="loading"
          />
        </div>

        <p v-if="error" class="login-error" role="alert">{{ error }}</p>

        <button class="btn btn-primary login-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>
    </div>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--sp-3);
}
.login-card {
  width: 100%;
  max-width: 400px;
  padding: var(--sp-4);
}
.login-header h1 {
  margin: 0 0 var(--sp-1);
  font-size: 22px;
  color: var(--c-ink);
}
.login-header p {
  margin: 0 0 var(--sp-3);
  font-size: 13px;
  color: var(--c-text-secondary);
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.login-error {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-danger);
  background: var(--c-fill);
  border-radius: var(--r-control);
}
.login-submit {
  justify-content: center;
}
</style>
