import { describe, expect, it } from 'vitest'
import {
  GRADIENT_PRESETS,
  averageLuminance,
  firstLetter,
  gradientFor,
  hashString,
  luminanceFilter,
  luminanceTier,
} from './cover'

describe('hashString', () => {
  it('相同输入稳定产出相同哈希', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
  })
  it('不同输入哈希落在 [0,1)', () => {
    for (const s of ['a', 'b', 'multica-demo', 'chart-kit']) {
      const h = hashString(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
    }
  })
})

describe('gradientFor', () => {
  it('稳定映射到六套渐层之一', () => {
    const g1 = gradientFor('multica-demo')
    const g2 = gradientFor('multica-demo')
    expect(g1).toEqual(g2)
    expect(GRADIENT_PRESETS).toContainEqual(g1)
  })
})

describe('firstLetter', () => {
  it('取项目名首字母并大写', () => {
    expect(firstLetter('multica-demo')).toBe('M')
    expect(firstLetter('  vue kit')).toBe('V')
  })
  it('空名回退问号', () => {
    expect(firstLetter('')).toBe('?')
    expect(firstLetter('   ')).toBe('?')
  })
})

describe('averageLuminance', () => {
  it('纯黑亮度为 0', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255])
    expect(averageLuminance(data)).toBeCloseTo(0, 5)
  })
  it('纯白亮度为 1', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255])
    expect(averageLuminance(data)).toBeCloseTo(1, 5)
  })
  it('空数据回退 0.5', () => {
    expect(averageLuminance(new Uint8ClampedArray(0))).toBe(0.5)
  })
})

describe('luminanceTier', () => {
  it('低于 15% 判 dark，高于 85% 判 light，其余 normal', () => {
    expect(luminanceTier(0.1)).toBe('dark')
    expect(luminanceTier(0.5)).toBe('normal')
    expect(luminanceTier(0.9)).toBe('light')
  })
})

describe('luminanceFilter', () => {
  it('dark 提亮、light 压暗、normal 不施加滤镜', () => {
    expect(luminanceFilter('dark')).toBe('brightness(1.2) contrast(0.95)')
    expect(luminanceFilter('light')).toBe('brightness(0.94)')
    expect(luminanceFilter('normal')).toBe('')
  })
})
