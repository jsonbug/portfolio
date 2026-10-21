<script setup lang="ts">
import { computed } from 'vue'
import { PUBLISH_STATUS_LABELS, type PublishStatus } from '@/types'
import AppBadge from './AppBadge.vue'

/**
 * 曝光状态徽标（后台专用，前台不展示曝光状态）。
 * 形态按 gap §6：已发布 ●（圆点）/ 草稿 ○（空环）/ 已归档 ■（实心方块，文字 #6E6862）——
 * 形状与文字双编码，不依赖颜色单独传达状态。
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
      return 'dot'
    case 'draft':
      return 'ring'
    default:
      return 'square'
  }
})
</script>

<template>
  <AppBadge :tone="tone" :shape="shape">{{ PUBLISH_STATUS_LABELS[status] }}</AppBadge>
</template>
