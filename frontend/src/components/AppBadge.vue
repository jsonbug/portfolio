<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

const props = withDefaults(defineProps<{ tone?: Tone }>(), { tone: 'neutral' })

// 状态须「圆点 + 文字」双重区分（无障碍要求）
const dotColor = computed(() => {
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
  <span class="badge">
    <span class="badge-dot" aria-hidden="true" :style="{ backgroundColor: dotColor }" />
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
.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.badge-text {
  font-weight: 600;
}
</style>
