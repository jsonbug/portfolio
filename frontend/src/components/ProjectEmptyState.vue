<script setup lang="ts">
/**
 * 列表空态：区分「确实没有项目」与「筛选后无结果」两种语义，
 * 后者给出「清除筛选」出口，避免用户卡在空页面上。
 */
defineProps<{ filtered: boolean }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div class="empty">
    <p class="empty-title">{{ filtered ? '没有符合条件的项目' : '还没有项目' }}</p>
    <p class="empty-hint">
      {{ filtered ? '试试换个关键词，或放宽技术栈筛选。' : '项目上线后会显示在这里。' }}
    </p>
    <button v-if="filtered" type="button" class="btn btn-sm" @click="emit('clear')">清除筛选</button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-48) var(--space-24);
  border: 1px dashed var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface);
  text-align: center;
}
.empty-title {
  margin: 0;
  font-size: var(--fs-h3);
  line-height: var(--lh-h3);
  font-weight: var(--fw-semibold);
  color: var(--c-ink);
}
.empty-hint {
  margin: 0;
  font-size: var(--fs-small);
  line-height: var(--lh-small);
  color: var(--c-text-secondary);
}
</style>
