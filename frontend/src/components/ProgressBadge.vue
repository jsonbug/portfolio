<script setup lang="ts">
import { computed } from 'vue'
import { PROGRESS_LABELS, type Progress } from '@/types'
import AppBadge from './AppBadge.vue'

/**
 * 进展徽标（前台卡片与后台列表共用）：半环=进行中，对勾=已上线。
 * 与曝光状态正交：归档项目也可能是「已上线」。
 */
const props = defineProps<{ progress: Progress }>()

const tone = computed(() => (props.progress === 'launched' ? 'success' : 'warning'))
const shape = computed(() => (props.progress === 'launched' ? 'check' : 'half'))
</script>

<template>
  <AppBadge :tone="tone" :shape="shape">{{ PROGRESS_LABELS[progress] }}</AppBadge>
</template>
