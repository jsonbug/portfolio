<script setup lang="ts">
/**
 * 列表空态（走查 #29）：区分「确实没有项目」与「筛选后无结果」两种语义。
 *
 * 筛空时把搜索词念回去（`「rust 波形」没有匹配项目`）——比「没有符合条件的项目」更能说明
 * 是哪一步筛没的；入口文案也统一成「清除全部筛选」，因为它同时清空搜索词与技术栈。
 */
const props = defineProps<{ filtered: boolean; query?: string }>()
const emit = defineEmits<{ clear: [] }>()

const title = () =>
  props.filtered ? (props.query ? `「${props.query}」没有匹配项目` : '没有匹配的项目') : '还没有发布的项目'
</script>

<template>
  <div class="empty">
    <p class="empty-title">{{ title() }}</p>
    <p class="empty-hint">
      {{ filtered ? '换个关键词，或放宽技术栈筛选。' : '仅『已发布』可见。' }}
    </p>
    <button v-if="filtered" type="button" class="btn btn-sm" @click="emit('clear')">
      清除全部筛选
    </button>
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
