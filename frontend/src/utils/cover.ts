/**
 * 封面渲染纯逻辑：渐层兜底（hash 加权选色）、sRGB 平均亮度分档。
 * 全部为纯函数，便于单测；画布采样由组件负责（跨域失败回退 normal）。
 */

export interface GradientPreset {
  from: string
  to: string
}

/** 六套渐层（方向 A 风格板，白字对最亮端对比度 ≥ 3.86:1）。 */
export const GRADIENT_PRESETS: GradientPreset[] = [
  { from: '#1B2350', to: '#5B79F0' },
  { from: '#12372F', to: '#2E7D63' },
  { from: '#3A2214', to: '#9A5B2E' },
  { from: '#1A1A1E', to: '#4A4E5A' },
  { from: '#2A1B3D', to: '#6B4E9E' },
  { from: '#3B1B22', to: '#8A3A47' },
]

/** FNV-1a 哈希 → [0,1)，稳定且均匀，避免相邻卡片命中相邻渐层。 */
export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** 按项目名稳定选取渐层（hash 加权）。 */
export function gradientFor(name: string): GradientPreset {
  const index = Math.floor(hashString(name) * GRADIENT_PRESETS.length) % GRADIENT_PRESETS.length
  return GRADIENT_PRESETS[index]
}

/** 渐层兜底展示的项目名首字母（大写）。 */
export function firstLetter(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}

export type LuminanceTier = 'dark' | 'normal' | 'light'

/** 深色阈值：平均亮度 < 15% 判定为暗。 */
export const LUMINANCE_DARK = 0.15
/** 亮色阈值：平均亮度 > 85% 判定为亮。 */
export const LUMINANCE_LIGHT = 0.85

/**
 * sRGB 相对亮度（Rec. 709 系数），输入 RGBA 字节数组（每 4 字节一个像素），
 * 输出 0..1 的平均亮度；空数据返回 0.5（视为正常档）。
 */
export function averageLuminance(data: Uint8ClampedArray): number {
  const pixelCount = data.length / 4
  if (pixelCount === 0) return 0.5
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return sum / pixelCount
}

/** 平均亮度 → 三档（dark / normal / light）。 */
export function luminanceTier(luminance: number): LuminanceTier {
  if (luminance < LUMINANCE_DARK) return 'dark'
  if (luminance > LUMINANCE_LIGHT) return 'light'
  return 'normal'
}

/** 各档位对应的 CSS filter（空串表示不施加滤镜）。 */
export function luminanceFilter(tier: LuminanceTier): string {
  if (tier === 'dark') return 'brightness(1.2) contrast(0.95)'
  if (tier === 'light') return 'brightness(0.94)'
  return ''
}
