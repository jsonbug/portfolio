import { describe, expect, it } from 'vitest'
import { GRID_SIZE, LONG_IMAGE_RATIO, firstLetter, isLongImage } from './cover'

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

describe('isLongImage', () => {
  it('高宽比 > 1.2 判为长图', () => {
    expect(isLongImage(1000, 1201)).toBe(true)
    expect(isLongImage(800, 2400)).toBe(true)
  })
  it('常规图与边界值不算长图', () => {
    expect(isLongImage(1000, 1200)).toBe(false)
    expect(isLongImage(1600, 900)).toBe(false)
  })
  it('拿不到尺寸时不算长图（图还没加载完）', () => {
    expect(isLongImage(0, 0)).toBe(false)
    expect(isLongImage(Number.NaN, 100)).toBe(false)
  })
})

describe('常量与 07 稿一致', () => {
  it('网格 16px、长图阈值 1.2', () => {
    expect(GRID_SIZE).toBe(16)
    expect(LONG_IMAGE_RATIO).toBe(1.2)
  })
})
