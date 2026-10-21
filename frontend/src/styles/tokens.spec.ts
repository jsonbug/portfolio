/**
 * 设计令牌契约测试（M2「设计令牌可用」）。
 *
 * 直接读取 style.css 的 :root 块，把 Style Tile（09-风格板）里的数值钉成断言：
 * 颜色、字号阶梯、间距刻度、圆角、阴影、控件尺寸与对比度下限。
 * 任何令牌改名/改值都会在这里先失败，避免「改样式时顺手改令牌」。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 直接读源码文本：vitest 配置 css:false 会把 CSS 导入 stub 成空串（?raw 亦不可用），
// 且 jsdom 下 import.meta.url 非 file: 协议，故以项目根定位。
const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

/** 提取 :root 内的 `--name: value` 映射。 */
function parseTokens(source: string): Map<string, string> {
  const root = source.slice(source.indexOf(':root'), source.indexOf('}', source.indexOf(':root')))
  const tokens = new Map<string, string>()
  for (const match of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim())
  }
  return tokens
}

const tokens = parseTokens(css)

function token(name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`缺少设计令牌 ${name}`)
  return value
}

/** WCAG 2.1 对比度（sRGB 相对亮度）。 */
function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

describe('设计令牌', () => {
  describe('色彩', () => {
    it('主色与辅色为方向 A 冻结值', () => {
      expect(token('--c-primary')).toBe('#2b4acb')
      expect(token('--c-primary-strong')).toBe('#1e36a0')
      expect(token('--c-primary-soft')).toBe('#edf0fe')
      expect(token('--c-accent')).toBe('#b84a22')
      expect(token('--c-accent-soft')).toBe('#fbede6') /* 走查 #25：粉 → 桃 */
    })

    it('中性色阶含输入框描边与已归档专用色', () => {
      expect(token('--c-ink')).toBe('#14110d')
      expect(token('--c-text')).toBe('#3d3833')
      expect(token('--c-text-secondary')).toBe('#6e6862')
      expect(token('--c-border')).toBe('#e6e2db')
      expect(token('--c-control-border')).toBe('#d6d1c8')
      expect(token('--c-fill')).toBe('#f4f2ee')
      expect(token('--c-surface')).toBe('#ffffff')
      /* 走查 #26：页面底 Paper 与卡片分开，否则层次塌陷 */
      expect(token('--c-page')).toBe('#fbfaf8')
      expect(token('--c-neutral-badge-bg')).toBe('#f1efec')
      // D6：已归档徽标文字色指定 #6E6862，保留实心方块形状
      expect(token('--c-neutral-badge-text')).toBe('#6e6862')
    })

    it('状态语义色沿用 Style Tile', () => {
      expect(token('--c-success')).toBe('#1e7a4d')
      expect(token('--c-warning')).toBe('#8a5b00')
      expect(token('--c-danger')).toBe('#b4342b')
    })

    it('封面 6 套渐层预设齐备', () => {
      for (let i = 1; i <= 6; i += 1) {
        expect(token(`--cover-grad-${i}-from`)).toMatch(/^#[0-9a-f]{6}$/)
        expect(token(`--cover-grad-${i}-to`)).toMatch(/^#[0-9a-f]{6}$/)
      }
    })
  })

  describe('对比度（N5：不设豁免，正文与徽标文字均 ≥4.5:1）', () => {
    const pairs: Array<[string, string, string]> = [
      ['正文 / 卡片底', '--c-text', '--c-surface'],
      ['主文字 / 页面底', '--c-ink', '--c-surface'],
      ['次要文字 / 卡片底', '--c-text-secondary', '--c-surface'],
      ['次要文字 / 次级填充', '--c-text-secondary', '--c-fill'],
      ['已归档徽标文字 / 徽标底', '--c-neutral-badge-text', '--c-neutral-badge-bg'],
      ['标签文字 / 主色浅底', '--c-primary-strong', '--c-primary-soft'],
      ['成功文字 / 卡片底', '--c-success', '--c-surface'],
      ['进行中文字 / 卡片底', '--c-warning', '--c-surface'],
    ]

    it.each(pairs)('%s ≥ 4.5:1', (_label, fg, bg) => {
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
    })

    it('主按钮白字 / 主色 ≥ 4.5:1', () => {
      expect(contrast('#ffffff', token('--c-primary'))).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('字号阶梯', () => {
    it('Display / H1 / H2 / Body / Small / Mono 齐全', () => {
      expect(token('--fs-display')).toBe('44px')
      expect(token('--lh-display')).toBe('52px')
      expect(token('--tracking-display')).toBe('-0.025em')
      expect(token('--fs-h1')).toBe('32px')
      expect(token('--lh-h1')).toBe('40px')
      expect(token('--fs-h2')).toBe('22px')
      expect(token('--lh-h2')).toBe('32px')
      expect(token('--fs-body')).toBe('15px')
      expect(token('--lh-body')).toBe('26px')
      expect(token('--fs-small')).toBe('13px')
      expect(token('--lh-small')).toBe('21px')
      expect(token('--fs-mono')).toBe('12px')
      expect(token('--lh-mono')).toBe('18px')
    })

    it('行高 ≥ 字号（正文 1.5 倍以上可读性）', () => {
      const sizes: Array<[string, string]> = [
        ['--fs-display', '--lh-display'],
        ['--fs-h1', '--lh-h1'],
        ['--fs-h2', '--lh-h2'],
        ['--fs-body', '--lh-body'],
        ['--fs-small', '--lh-small'],
      ]
      for (const [size, height] of sizes) {
        expect(parseFloat(token(height))).toBeGreaterThanOrEqual(parseFloat(token(size)))
      }
    })
  })

  describe('间距刻度（8pt 栅格 + 4px 微调）', () => {
    it('4/8/12/16/24/32/40/48/64 齐备', () => {
      expect(['4', '8', '12', '16', '24', '32', '40', '48', '64'].map((n) => token(`--space-${n}`))).toEqual([
        '4px',
        '8px',
        '12px',
        '16px',
        '24px',
        '32px',
        '40px',
        '48px',
        '64px',
      ])
    })

    it('旧别名 --sp-* 仍可解析且落在栅格上', () => {
      const legacy: Record<string, string> = {
        '--sp-0': '4px',
        '--sp-1': '8px',
        '--sp-2': '16px',
        '--sp-3': '24px',
        '--sp-4': '32px',
        '--sp-5': '48px',
      }
      for (const [name, expected] of Object.entries(legacy)) {
        expect(token(name)).toBe(`var(${`--space-${parseFloat(expected)}`})`)
      }
    })
  })

  describe('圆角 / 阴影 / 尺寸', () => {
    it('圆角四档 + 胶囊，16 只用于弹层', () => {
      expect(token('--r-tag')).toBe('4px')
      expect(token('--r-control')).toBe('8px')
      expect(token('--r-card')).toBe('12px')
      expect(token('--r-overlay')).toBe('16px')
      expect(token('--r-pill')).toBe('999px')
    })

    it('阴影三级（静止 / 悬停 / 弹层）', () => {
      expect(token('--shadow-e1')).toMatch(/^0 1px 2px/)
      expect(token('--shadow-e2')).toMatch(/^0 4px 16px/)
      expect(token('--shadow-e3')).toMatch(/^0 12px 32px/)
    })

    it('焦点环 2px + 2px offset（N5）', () => {
      expect(token('--focus-width')).toBe('2px')
      expect(token('--focus-offset')).toBe('2px')
      expect(css).toContain('outline: var(--focus-width) solid var(--c-primary)')
    })

    it('控件与热区尺寸符合标注稿', () => {
      expect(token('--control-h')).toBe('36px')
      expect(token('--btn-h')).toBe('38px')
      expect(token('--btn-h-sm')).toBe('32px')
      expect(token('--touch-min')).toBe('44px')
    })

    it('布局：内容区 1376、卡片 24、后台最小 768', () => {
      expect(token('--content-max')).toBe('1376px')
      expect(token('--card-gap')).toBe('24px')
      expect(token('--admin-min-width')).toBe('768px')
    })
  })

  describe('徽标对比度（走查 #5 / 硬要求①）', () => {
  /* 徽标是状态双编码的一半：形状之外，字必须读得清 —— 每对「字色 / 底色」都在这里钉死 */
  const pairs: Array<[string, string, string]> = [
    ['已上线 check', '--c-success', '--c-success-soft'],
    ['进行中 half', '--c-warning', '--c-warning-soft'],
    ['已发布 dot', '--c-text', '--c-published-badge-bg'],
    ['草稿 虚线环', '--c-text-secondary', '--c-surface'],
    ['已归档 square', '--c-neutral-badge-text', '--c-neutral-badge-bg'],
    ['危险 dot', '--c-danger', '--c-danger-soft'],
    ['主色 dot', '--c-primary-strong', '--c-primary-soft'],
    ['提示块', '--c-accent', '--c-accent-soft'],
  ]

  for (const [label, fg, bg] of pairs) {
    it(`${label}：${fg} on ${bg} ≥ 4.5:1（AA 正文）`, () => {
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('页面底上的正文对比度仍达标（Paper 底不拖累可读性）', () => {
    expect(contrast(token('--c-text'), token('--c-page'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('字体', () => {
    it('中文走 HarmonyOS Sans SC，等宽独立', () => {
      expect(token('--font-sans')).toContain('HarmonyOS Sans SC')
      expect(token('--font-mono')).toContain('DejaVu Sans Mono')
    })
  })
})
