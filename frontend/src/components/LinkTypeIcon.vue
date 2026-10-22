<script setup lang="ts">
import type { LinkType } from '@/types'

/**
 * F3：链接类型图标（内联 SVG，不引图标库）。
 *
 * 一律 `aria-hidden`：图标旁边总有文字标签（列表卡片上是 `aria-label`），
 * 不隐藏的话读屏会把同一个意思念两遍。
 */
defineProps<{ type: LinkType }>()
</script>

<template>
  <svg class="link-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <!-- 源码仓库：分支 -->
    <g v-if="type === 'repo'" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <circle cx="4.6" cy="3.6" r="1.8" />
      <circle cx="4.6" cy="12.4" r="1.8" />
      <circle cx="11.4" cy="5.4" r="1.8" />
      <path d="M4.6 5.4v5.2M11.4 7.2c0 2.4-2.6 2.2-4.2 3.4" />
    </g>
    <!-- 官网：地球 -->
    <g v-else-if="type === 'site'" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M2.6 8h10.8M8 2.4c2.8 3.2 2.8 8 0 11.2M8 2.4c-2.8 3.2-2.8 8 0 11.2" stroke-linecap="round" />
    </g>
    <!-- 文档：书页 -->
    <g v-else-if="type === 'docs'" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <path d="M3.2 3.2h6.4l3.2 3v6.6H3.2z" />
      <path d="M9.4 3.2v3.2h3.2M5.6 9.4h4.8" />
    </g>
    <!-- 在线演示：播放 -->
    <g v-else-if="type === 'demo'" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M6.8 5.9l3.6 2.1-3.6 2.1z" fill="currentColor" stroke="none" />
    </g>
    <!-- 其他：外链 -->
    <g v-else fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <path d="M6.6 3.4H3.4v9.2h9.2V9.4" />
      <path d="M9 2.6h4.4v4.4M13.2 2.8L7.8 8.2" />
    </g>
  </svg>
</template>

<style scoped>
.link-icon {
  display: block;
  flex: none;
}
</style>
