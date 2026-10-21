<script setup lang="ts">
import { safeHttpUrl } from '@/utils/link'
import { computed, ref, watch } from 'vue'
import {
  averageLuminance,
  firstLetter,
  gradientFor,
  luminanceFilter,
  luminanceTier,
  type LuminanceTier,
} from '@/utils/cover'

/**
 * 项目封面：按 cover-spec 渲染。
 * - 有 coverImage：等比铺满裁切（card 锚点 y=30% → 保留源图 14%–67%），
 *   运行时 canvas 采样平均亮度分档施加滤镜，跨域失败回退 normal。
 * - 无 coverImage 或加载失败：hash 加权渐层兜底 + 项目名首字母。
 * - 统一 1px 内描边（rgba(#141100, 8%)）。
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
const tier = ref<LuminanceTier>('normal')

const gradient = computed(() => gradientFor(props.name))
const letter = computed(() => firstLetter(props.name))
const fallbackStyle = computed(() => ({
  background: `linear-gradient(135deg, ${gradient.value.from}, ${gradient.value.to})`,
}))
const filterStyle = computed(() => luminanceFilter(tier.value))
const safeCover = computed(() => safeHttpUrl(props.coverImage))
// 只有白名单内的地址才渲染 <img>：非法地址（javascript: 等）直接走渐变兜底
const showImage = computed(() => safeCover.value != null && !failed.value)

function sampleLuminance(img: HTMLImageElement): LuminanceTier {
  try {
    const size = 16
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 'normal'
    ctx.drawImage(img, 0, 0, size, size)
    return luminanceTier(averageLuminance(ctx.getImageData(0, 0, size, size).data))
  } catch {
    // 跨域污染或环境无 canvas：按正常档处理。
    return 'normal'
  }
}

function onLoad(event: Event): void {
  tier.value = sampleLuminance(event.target as HTMLImageElement)
}

function onError(): void {
  failed.value = true
}

watch(
  () => props.coverImage,
  () => {
    failed.value = false
    tier.value = 'normal'
  },
)
</script>

<template>
  <div
    class="cover"
    :class="[`cover--${variant}`, `cover--${tier}`]"
    role="img"
    :aria-label="`${name} 封面`"
  >
    <img
      v-if="showImage"
      class="cover-img"
      :src="safeCover ?? undefined"
      :style="{ filter: filterStyle }"
      alt=""
      loading="lazy"
      @load="onLoad"
      @error="onError"
    />
    <div v-else class="cover-fallback" :style="fallbackStyle">
      <span class="cover-letter">{{ letter }}</span>
    </div>
    <span v-if="showImage && tier === 'dark'" class="cover-wash" aria-hidden="true" />
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  overflow: hidden;
  width: 100%;
  background: var(--c-fill);
  /* 1px 内描边 rgba(#141100, 8%) */
  box-shadow: inset 0 0 0 1px rgba(20, 17, 13, 0.08);
}
.cover--card {
  aspect-ratio: 442 / 132; /* 3.35:1 */
  border-radius: var(--r-card);
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
}
.cover--card .cover-img {
  object-position: 50% 30%; /* 锚点 y=30% → 保留源图 14%–67% */
}
.cover--hero .cover-img,
.cover--thumb .cover-img {
  object-position: 50% 50%;
}
.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.cover-letter {
  font-size: 40px;
  font-weight: 600;
  line-height: 1;
  color: rgba(255, 255, 255, 0.92); /* 白 92% */
}
.cover--thumb .cover-letter {
  font-size: 16px;
}
/* 暗图白色柔光膜（4%），避免滤镜后过沉 */
.cover-wash {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.04);
  pointer-events: none;
}
</style>
