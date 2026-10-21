<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

/**
 * 形态语义（设计令牌 v1.2）：
 * - `dot`    默认圆点
 * - `half`   半环：进行中（未完成，可继续推进）
 * - `check`  对勾：已上线 / 已发布
 * - `square` 实心方块：草稿（未定稿）
 * - `ring`   空心环：已归档（保留不活跃状态）
 */
type Shape = 'dot' | 'half' | 'check' | 'square' | 'ring'

const props = withDefaults(defineProps<{ tone?: Tone; shape?: Shape }>(), {
  tone: 'neutral',
  shape: 'dot',
})

/** 状态须「形态 + 文字」双重区分（无障碍要求：不依赖颜色）。 */
const toneColor = computed(() => {
  switch (props.tone) {
    case 'primary':
      return 'var(--c-primary)'
    case 'success':
      return 'var(--c-success)'
    case 'warning':
      return 'var(--c-warning)'
    case 'danger':
      return 'var(--c-danger)'
    default:
      return 'var(--c-text-secondary)'
  }
})
</script>

<template>
  <span class="badge" :class="`badge--${tone}`">
    <span class="badge-mark" :style="{ '--mark-color': toneColor }" aria-hidden="true">
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
  gap: 6px;
  padding: 2px 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--c-text-secondary);
  background: var(--c-fill);
  border-radius: var(--r-pill);
  white-space: nowrap;
}
/* 已归档：中性底 + 指定文字色（对比度 4.8:1） */
.badge--neutral {
  color: var(--c-neutral-badge-text);
  background: var(--c-neutral-badge-bg);
}
.badge-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--mark-color);
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
  font-weight: 600;
}
</style>
