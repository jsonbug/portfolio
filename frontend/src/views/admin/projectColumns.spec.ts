import { describe, expect, it } from 'vitest'
import {
  COLUMN_BREAKPOINTS,
  PROJECT_LIST_COLUMNS,
  hiddenColumns,
  visibleColumns,
} from './projectColumns'

const keysAt = (width: number) => visibleColumns(width).map((column) => column.key)

describe('后台项目列表列配置', () => {
  it('展示顺序固定：名称 → slug → 发布状态 → 进展 → 链接 → 更新时间 → 操作', () => {
    expect(PROJECT_LIST_COLUMNS.map((column) => column.key)).toEqual([
      'name',
      'slug',
      'publish_status',
      'progress',
      'links',
      'updated_at',
      'actions',
    ])
  })

  it('优先级从右往左递增：minWidth 越大越靠右（否则「从右往左隐藏」就不成立）', () => {
    const widths = PROJECT_LIST_COLUMNS.map((column) => column.minWidth)
    // 非 0 的阈值必须随展示顺序单调不减，0 表示恒显，允许出现在左侧
    const positive = widths.filter((width) => width > 0)
    expect(positive).toEqual([...positive].sort((a, b) => a - b))
  })

  it('768 整宽：7 列全显', () => {
    expect(keysAt(768)).toEqual([
      'name',
      'slug',
      'publish_status',
      'progress',
      'links',
      'updated_at',
      'actions',
    ])
    expect(hiddenColumns(768)).toEqual([])
  })

  it('767：只隐最右一列「操作」', () => {
    expect(keysAt(767)).toEqual([
      'name',
      'slug',
      'publish_status',
      'progress',
      'links',
      'updated_at',
    ])
    expect(hiddenColumns(767).map((column) => column.key)).toEqual(['actions'])
  })

  it('逐级变窄按 priority 依次消失（操作 → 更新时间 → 进展 → slug）', () => {
    expect(keysAt(640)).toEqual(['name', 'slug', 'publish_status', 'progress', 'links', 'updated_at'])
    expect(keysAt(639)).toEqual(['name', 'slug', 'publish_status', 'progress', 'links'])
    expect(keysAt(512)).toEqual(['name', 'slug', 'publish_status', 'progress', 'links'])
    expect(keysAt(511)).toEqual(['name', 'slug', 'publish_status', 'links'])
    expect(keysAt(384)).toEqual(['name', 'slug', 'publish_status', 'links'])
    expect(keysAt(383)).toEqual(['name', 'publish_status', 'links'])
  })

  it('恢复宽度后列序不变：宽 → 窄 → 宽，两次宽度下可见列完全一致', () => {
    const wide = keysAt(1440)
    keysAt(320)
    expect(keysAt(1440)).toEqual(wide)
    expect(keysAt(1440)).toEqual(keysAt(768))
  })

  it('任何宽度下列序都是完整列序的子序列（隐藏只做减法，不重排）', () => {
    const full = PROJECT_LIST_COLUMNS.map((column) => column.key)
    for (let width = 320; width <= 1600; width += 37) {
      const keys = keysAt(width)
      const filtered = full.filter((key) => keys.includes(key))
      expect(keys).toEqual(filtered)
    }
  })

  it('恒显列在任何宽度下都不消失：名称 / 发布状态 / 链接', () => {
    for (const width of [0, 320, 767, 1024, 1920]) {
      const keys = keysAt(width)
      expect(keys).toContain('name')
      expect(keys).toContain('publish_status')
      expect(keys).toContain('links')
    }
  })

  it('更窄不会让已隐藏的列回来（宽度单调 → 可见列单调收缩）', () => {
    for (let width = 1600; width > 320; width -= 1) {
      const wider = keysAt(width)
      const narrower = keysAt(width - 1)
      expect(narrower.every((key) => wider.includes(key))).toBe(true)
    }
  })

  it('断点表与列配置一致（加第 8 列时这里会提示补用例）', () => {
    expect(COLUMN_BREAKPOINTS).toEqual([768, 640, 512, 384])
  })
})
