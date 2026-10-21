import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ProjectCover from './ProjectCover.vue'

describe('ProjectCover', () => {
  it('coverImage 为空时渲染渐层兜底 + 首字母', () => {
    render(ProjectCover, { props: { name: 'multica-demo', coverImage: null, variant: 'card' } })
    expect(screen.getByRole('img', { name: 'multica-demo 封面' })).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('coverImage 非空时渲染 <img> 且不渲染首字母', () => {
    const { container } = render(ProjectCover, {
      props: { name: 'demo', coverImage: 'https://example.com/a.jpg', variant: 'card' },
    })
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('https://example.com/a.jpg')
    expect(screen.queryByText('D')).not.toBeInTheDocument()
  })

  it('不同变体输出不同 aspect 容器类', () => {
    const { container } = render(ProjectCover, {
      props: { name: 'demo', coverImage: null, variant: 'hero' },
    })
    expect(container.querySelector('.cover--hero')).toBeTruthy()
  })
})

describe('ProjectCover 封面地址白名单', () => {
  it('非 http(s) 的 cover_image_url 不产出 img（回落渐变）', () => {
    render(ProjectCover, {
      props: { name: '可疑封面', coverImage: 'javascript:alert(1)', variant: 'card' },
    })
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: '可疑封面 封面' })).toBeInTheDocument()
  })

  it('http(s) 封面正常输出 img', () => {
    render(ProjectCover, {
      props: { name: '正常封面', coverImage: 'https://images.example.com/a.png', variant: 'card' },
    })
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/a.png')
  })
})
