<script setup lang="ts">
/** 列表首屏骨架：结构对齐 ProjectCard，高度锁死 329（走查 #30），避免加载完成时的布局跳动（CLS）。 */
withDefaults(defineProps<{ count?: number }>(), { count: 6 })
</script>

<template>
  <ul class="grid" aria-hidden="true">
    <li v-for="n in count" :key="n" class="card skeleton-card">
      <div class="skeleton skeleton-cover"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line skeleton-line--title"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line skeleton-line--short"></div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
}
.skeleton-card {
  overflow: hidden;
  /* 走查 #30：卡片高锁死 329，骨架 → 真实卡片时不留跳动（CLS） */
  height: 329px;
}
.skeleton {
  background: linear-gradient(90deg, var(--c-fill) 25%, #eceae5 37%, var(--c-fill) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}
.skeleton-cover {
  aspect-ratio: 442 / 132;
  width: 100%;
}
.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-16);
}
.skeleton-line {
  height: 12px;
  border-radius: var(--r-tag);
}
.skeleton-line--title {
  height: 18px;
  width: 55%;
}
.skeleton-line--short {
  width: 35%;
}
@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
@media (min-width: 768px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1280px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
