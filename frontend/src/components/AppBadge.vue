<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'published'

/**
 * 形态语义（D6 稿：状态必须「形状 + 文字」双编码，不依赖颜色）：
 * - `dot`         默认圆点
 * - `half`        半环：进行中
 * - `check`       对勾：已上线 / 已发布
 * - `square`      实心方块
 * - `ring`        空心环：已归档
 * - `ring-dashed` 虚线空环：草稿（未定稿），白底 + 虚线描边
 */
type Shape = 'dot' | 'half' | 'check' | 'square' | 'ring' | 'ring-dashed'

const props = withDefaults(defineProps<{ tone?: Tone; shape?: Shape }>(), {
  tone: 'neutral',
  shape: 'dot',
})

/**
 * 每个 tone 的底色与字色都按走查 #5 的指定值走（不再所有 tone 共用 `--c-fill`）：
 * 徽标是状态双编码的一半，字看不清等于没编码 —— 见 `src/styles/tokens.spec.ts` 的对比度断言。
 */
const TONE_CLASS = {
  primary: 'badge--primary',
  success: 'badge--success',
  warning: 'badge--warning',
  danger: 'badge--danger',
  neutral: 'badge--neutral',
  published: 'badge--published',
} as const

const toneClass = computed(() => TONE_CLASS[props.tone])
</script>

<template>
  <span class="badge" :class="[toneClass, { 'badge--dashed': shape === 'ring-dashed' }]">
    <span class="badge-mark" aria-hidden="true">
      <svg v-if="shape === 'half'" class="mark-svg" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M6 1a5 5 0 0 1 0 10Z" fill="currentColor" />
      </svg>
      <svg v-else-if="shape === 'check'" class="mark-svg" viewBox="0 0 12 12">
        <path
          d="M2.5 6.2l2.3 2.3 4.7-4.9"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else-if="shape === 'ring'" class="mark-svg" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <svg v-else-if="shape === 'ring-dashed'" class="mark-svg" viewBox="0 0 12 12">
        <circle
          cx="6"
          cy="6"
          r="4.25"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-dasharray="2.2 1.8"
        />
      </svg>
      <span v-else-if="shape === 'square'" class="mark-square" />
      <span v-else class="mark-dot" />
    </span>
    <span class="badge-text"><slot /></span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  font-size: var(--fs-mono);
  line-height: 18px;
  border-radius: var(--r-pill);
  white-space: nowrap;
  /* 底色/字色由 tone 类给，图标颜色跟随字色（currentColor） */
  color: inherit;
}
.badge--neutral {
  color: var(--c-neutral-badge-text);
  background: var(--c-neutral-badge-bg);
}
.badge--published {
  /* 已发布：中性圆点（走查 #5 的 #EFEEE9 / #3D3833），与「已归档」的 #F1EFEC 微差以示区别 */
  color: var(--c-text);
  background: var(--c-published-badge-bg);
}
.badge--success {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.badge--warning {
  color: var(--c-warning);
  background: var(--c-warning-soft);
}
.badge--primary {
  color: var(--c-primary-strong);
  background: var(--c-primary-soft);
}
.badge--danger {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
/* 草稿：白底 + 虚线空环（走查 #5） */
.badge--dashed {
  color: var(--c-text-secondary);
  background: var(--c-surface);
  box-shadow: inset 0 0 0 1px var(--c-border);
}
.badge-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex: none;
}
.mark-svg {
  width: 12px;
  height: 12px;
  display: block;
}
.mark-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.mark-square {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  background: currentColor;
}
.badge-text {
  font-weight: var(--fw-semibold);
}
</style>
