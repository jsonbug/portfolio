<script setup lang="ts">
import { computed } from 'vue'
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/types'
import AppBadge from './AppBadge.vue'

const props = defineProps<{ status: ProjectStatus }>()

const tone = computed(() => {
  switch (props.status) {
    case 'published':
      return 'success'
    case 'draft':
      return 'warning'
    case 'archived':
      return 'neutral'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <AppBadge :tone="tone">{{ PROJECT_STATUS_LABELS[status] }}</AppBadge>
</template>
