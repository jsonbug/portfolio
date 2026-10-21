<script setup lang="ts">
import { computed } from 'vue'
import { PUBLISH_STATUS_LABELS, type PublishStatus } from '@/types'
import AppBadge from './AppBadge.vue'

/**
 * 曝光状态徽标（后台专用，前台不展示曝光状态）。
 * 形态：已发布 ✓ / 草稿 ■ / 已归档 ○ —— 与文字共同承担语义。
 */
const props = defineProps<{ status: PublishStatus }>()

const tone = computed(() => {
  switch (props.status) {
    case 'published':
      return 'success'
    case 'draft':
      return 'warning'
    default:
      return 'neutral'
  }
})

const shape = computed(() => {
  switch (props.status) {
    case 'published':
      return 'check'
    case 'draft':
      return 'square'
    default:
      return 'ring'
  }
})
</script>

<template>
  <AppBadge :tone="tone" :shape="shape">{{ PUBLISH_STATUS_LABELS[status] }}</AppBadge>
</template>
