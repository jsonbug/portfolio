<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'

const route = useRoute()
/** 后台自带侧栏与登录页布局，不显示前台导航。 */
const showHeader = computed(() => !route.path.startsWith('/admin'))
</script>

<template>
  <AppHeader v-if="showHeader" />
  <RouterView />
</template>
