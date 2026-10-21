import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * 视口宽度（px），随 resize 更新。
 *
 * 后台列表的隐列规则放在 `projectColumns.ts` 的数据表里，需要宽度这个输入；
 * 用 JS 读宽度而不是 CSS media query，是为了让「哪个断点隐哪列」可被单测直接断言
 * （jsdom 不计算样式，`display:none` 断言不出来）。
 */
export function useViewportWidth(): { width: Ref<number> } {
  const width = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)

  const update = () => {
    width.value = window.innerWidth
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', update)
  })

  return { width }
}
