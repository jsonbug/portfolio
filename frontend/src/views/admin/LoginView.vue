<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { loginErrorMessage, safeRedirect } from '@/utils/login'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const usernameInput = ref<HTMLInputElement | null>(null)

// 失败后开始输入就撤掉错误态，避免「已经改了却还在报旧错」
watch([username, password], () => {
  if (error.value) error.value = ''
})

onMounted(async () => {
  // nextTick：等首个渲染帧落地再聚焦，避免个别浏览器/测试环境里 ref 尚未挂到文档就 focus
  await nextTick()
  usernameInput.value?.focus()
})

async function onSubmit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    // 后端 401 的 message 不透出（契约 §1.3：不区分账号/口令），文案按状态码在前端固定
    error.value = loginErrorMessage(e instanceof ApiError ? e.status : null)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login">
    <div class="card login-card">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">F</span>
        <span class="brand-name">Folio</span>
        <span class="brand-sep" aria-hidden="true">/</span>
        <span class="brand-scope">后台</span>
      </div>

      <h1 class="login-title">登录后台</h1>
      <p class="login-sub">仅站长可登录，前台无需账号。</p>

      <form class="login-form" novalidate @submit.prevent="onSubmit">
        <div class="field">
          <label class="field-label" for="username">账号</label>
          <input
            id="username"
            ref="usernameInput"
            v-model="username"
            class="input login-input"
            name="username"
            type="text"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            required
            :disabled="loading"
          />
        </div>

        <div class="field" :class="{ 'field--error': error }">
          <label class="field-label" for="password">密码</label>
          <div class="password-wrap">
            <input
              id="password"
              v-model="password"
              class="input login-input password-input"
              name="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              :disabled="loading"
              :aria-invalid="error ? 'true' : undefined"
              :aria-describedby="error ? 'login-error' : undefined"
            />
            <button
              class="password-toggle"
              type="button"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :aria-pressed="showPassword"
              :disabled="loading"
              @click="showPassword = !showPassword"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="M1.8 10s3-5.2 8.2-5.2S18.2 10 18.2 10s-3 5.2-8.2 5.2S1.8 10 1.8 10Z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
                <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.4" />
                <line
                  v-if="showPassword"
                  x1="3.4"
                  y1="16.6"
                  x2="16.6"
                  y2="3.4"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
          <p v-if="error" id="login-error" class="login-error" role="alert">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4" />
              <line x1="8" y1="4.8" x2="8" y2="8.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              <circle cx="8" cy="11.1" r="0.85" fill="currentColor" />
            </svg>
            <span>{{ error }}</span>
          </p>
        </div>

        <button class="btn btn-primary login-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>

      <p class="login-note">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M8 1.8 13 3.6v4.1c0 3-2 5.4-5 6.5-3-1.1-5-3.5-5-6.5V3.6L8 1.8Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
        <span>会话过期后需重新登录；退出后后台接口立即失效。</span>
      </p>
    </div>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--space-24);
  background-color: var(--c-surface);
  /* 视觉稿的细点纹理：1px 点阵，密度低到不抢内容 */
  background-image: radial-gradient(var(--c-border) 1px, transparent 1px);
  background-size: 16px 16px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: var(--space-32);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-e3);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-24);
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: var(--icon-size);
  height: var(--icon-size);
  border-radius: var(--r-control);
  background: var(--c-ink);
  color: var(--c-surface);
  font-size: var(--fs-small);
  font-weight: var(--fw-bold);
}

.brand-name {
  color: var(--c-ink);
  font-weight: var(--fw-semibold);
}

.brand-sep {
  color: var(--c-border);
}

.login-title {
  margin: 0 0 var(--space-8);
  font-size: var(--fs-h2);
  line-height: var(--lh-h2);
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
}

.login-sub {
  margin: 0 0 var(--space-24);
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.login-input {
  width: 100%;
  height: 40px;
  padding: 0 var(--space-12);
  font-size: var(--fs-body);
}

.password-wrap {
  position: relative;
}

.password-input {
  padding-right: 44px;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 2px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  transform: translateY(-50%);
  border: 0;
  border-radius: var(--r-control);
  background: transparent;
  color: var(--c-text-secondary);
  cursor: pointer;
}

.password-toggle:hover {
  background: var(--c-fill);
  color: var(--c-ink);
}

.password-toggle:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}

/* 错误只挂密码字段，不整卡标红 */
.field--error .login-input {
  border-color: var(--c-danger);
  box-shadow: 0 0 0 3px rgba(180, 52, 43, 0.12);
}

.login-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  margin: var(--space-8) 0 0;
  font-size: 12px;
  line-height: var(--lh-mono);
  color: var(--c-danger);
}

.login-error svg {
  margin-top: 2px;
  flex: none;
}

.login-submit {
  justify-content: center;
  width: 100%;
  height: 44px;
  margin-top: var(--space-8);
}

.login-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  margin: var(--space-24) 0 0;
  padding-top: var(--space-16);
  border-top: 1px solid var(--c-border);
  font-size: 12px;
  line-height: var(--lh-mono);
  color: var(--c-text-secondary);
}

.login-note svg {
  margin-top: 1px;
  flex: none;
}

@media (max-width: 480px) {
  .login {
    padding: var(--space-16);
  }

  .login-card {
    padding: var(--space-24);
  }
}
</style>
