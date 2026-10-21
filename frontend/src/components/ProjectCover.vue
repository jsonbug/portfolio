<script setup lang="ts">
import { safeHttpUrl } from '@/utils/link'
import { computed, ref, watch } from 'vue'
import { COVER_RADIUS, FALLBACK_LETTER_COLOR, firstLetter, isLongImage } from '@/utils/cover'

/**
 * 项目封面（设计稿 07 / D4 专项）：
 * - 有 coverImage：`object-fit: cover` 铺满，**不调色、不投影、不滤镜**，只加 1px 内描边；
 *   长图（高/宽 > 1.2）顶部对齐裁切，并在右下角出「长图 · 点击查看原图」角标。
 * - 无 coverImage 或加载失败：首字 + `#B4AEA5` + 16px 网格底，**不按名称/ID 生成彩色块**。
 * - 圆角 6px（与卡片的 12px 分开），描边 `inset 0 0 0 1px #E6E2DB`。
 */
const props = withDefaults(
  defineProps<{
    name: string
    coverImage: string | null
    variant?: 'card' | 'hero' | 'thumb'
  }>(),
  { variant: 'card' },
)

const failed = ref(false)
const long = ref(false)

const letter = computed(() => firstLetter(props.name))
const safeCover = computed(() => safeHttpUrl(props.coverImage))
// 只有白名单内的地址才渲染 <img>：非法地址（javascript: 等）直接走首字兜底
const showImage = computed(() => safeCover.value != null && !failed.value)

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  long.value = isLongImage(img.naturalWidth, img.naturalHeight)
}

function onError(): void {
  failed.value = true
}

watch(
  () => props.coverImage,
  () => {
    failed.value = false
    long.value = false
  },
)
</script>

<template>
  <div
    class="cover"
    :class="[`cover--${variant}`, { 'cover--long': showImage && long }]"
    :style="{ '--cover-radius': `${COVER_RADIUS}px` }"
    role="img"
    :aria-label="`${name} 封面`"
  >
    <img
      v-if="showImage"
      class="cover-img"
      :src="safeCover ?? undefined"
      alt=""
      loading="lazy"
      @load="onLoad"
      @error="onError"
    />
    <div v-else class="cover-fallback">
      <span class="cover-letter" :style="{ color: FALLBACK_LETTER_COLOR }">{{ letter }}</span>
    </div>
    <span v-if="showImage && long" class="cover-long-mark" aria-hidden="true">长图 · 点击查看原图</span>
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  overflow: hidden;
  width: 100%;
  background: var(--c-surface);
  border-radius: var(--cover-radius);
  /* 07 稿：只加 1px 内描边，不投影 */
  box-shadow: inset 0 0 0 1px var(--c-border);
}
.cover--card {
  aspect-ratio: 442 / 132; /* 3.35:1，效果图测量值 */
}
.cover--hero {
  aspect-ratio: 16 / 9;
  border-radius: var(--r-overlay);
}
.cover--thumb {
  aspect-ratio: 1 / 1;
  border-radius: var(--r-control);
}
.cover-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover; /* 等比铺满裁切，禁拉伸/letterbox */
  object-position: 50% 50%;
}
/* 长图：顶部对齐，先给标题区看 */
.cover--long .cover-img {
  object-position: 50% 0;
}
.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  /* 16px 网格底（07 稿），用两条 1px 渐变线拼出来，不额外引入图片 */
  background-image:
    linear-gradient(to right, var(--c-border) 1px, transparent 1px),
    linear-gradient(to bottom, var(--c-border) 1px, transparent 1px);
  background-size: 16px 16px;
  background-position: -1px -1px;
  background-color: var(--c-page);
}
.cover-letter {
  font-size: 38px;
  font-weight: var(--fw-semibold);
  line-height: 1;
  user-select: none;
}
.cover--hero .cover-letter {
  font-size: 56px;
}
.cover--thumb .cover-letter {
  font-size: 16px;
}
.cover-long-mark {
  position: absolute;
  right: var(--space-8);
  bottom: var(--space-8);
  padding: 2px var(--space-8);
  border-radius: var(--r-tag);
  background: rgba(20, 17, 13, 0.72);
  color: #fff;
  font-size: var(--fs-mono);
  line-height: var(--lh-mono);
}
</style>
