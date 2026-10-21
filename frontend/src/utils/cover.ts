/**
 * 封面渲染的纯逻辑（设计稿 07 / D4 专项）。
 *
 * 07 稿的负向清单写得很清楚：**不做色块随机化、不按 id 生成彩色块**。
 * 所以这里没有任何 hash → 渐层的映射：无封面就是「首字 + 网格底」这一种固定样式。
 * 渐层只在「有封面但还没加载完」时作为占位出现（09 风格板降级用法）。
 */

/** 首字兜底色：07 稿指定 #B4AEA5（浅灰），刻意不与任何状态色抢注意力。 */
export const FALLBACK_LETTER_COLOR = '#B4AEA5'

/** 兜底底纹的网格步长（07 稿：16px 方格）。 */
export const GRID_SIZE = 16

/** 封面圆角（07 稿：6px，与卡片的 12px 分开）。 */
export const COVER_RADIUS = 6

/** 高宽比超过该值按「长图」处理（顶部对齐 + 角标）。 */
export const LONG_IMAGE_RATIO = 1.2

/** 兜底展示的项目名首字母（大写）。 */
export function firstLetter(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}

/** 是否为长图（高 / 宽 > 1.2）：长图顶部对齐裁切，并在右下角出「长图」角标。 */
export function isLongImage(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false
  return height / width > LONG_IMAGE_RATIO
}
