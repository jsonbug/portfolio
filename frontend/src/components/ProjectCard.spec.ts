import { render, screen, within } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ProjectCard from './ProjectCard.vue'
import type { Link, ProjectListItem } from '@/types'

const baseItem: ProjectListItem = {
  id: 'p1',
  slug: 'demo',
  name: '演示项目',
  summary: '一句话摘要',
  cover_image_url: null,
  progress: 'ongoing',
  stars: 7,
  version: '1.0.0',
  last_updated_at: '2026-10-01T00:00:00.000Z',
  tech_stack: ['Vue 3'],
  links: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
}

function renderCard(item: ProjectListItem) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/projects/:slug', name: 'project-detail', component: { template: '<div />' } }],
  })
  return render(ProjectCard, { props: { item }, global: { plugins: [router] } })
}

describe('ProjectCard', () => {
  it('F9 卡片侧：只有 failed 降级（class + ⚠ + title），ok/unknown/null 一律同款', () => {
    const link = (id: string, type: 'repo' | 'site', last_status: Link['last_status']): Link => ({
      id,
      type,
      label: type === 'repo' ? 'GitHub' : '官网',
      url: type === 'repo' ? 'https://github.com/x/y' : 'https://demo.example.com',
      sort: 0,
      last_status,
      last_http_status: last_status === 'failed' ? 502 : null,
      last_checked_at: last_status === 'unknown' ? null : '2026-10-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    })

    // failed：低对比 + ⚠ + title 说明；仍可点
    renderCard({ ...baseItem, links: [link('l1', 'repo', 'failed'), link('l2', 'site', 'unknown')] })
    const failedRepo = screen.getByRole('link', { name: '仓库 · 演示项目（新窗口打开，链接检查失败）' })
    expect(failedRepo.className).toContain('card-link--failed')
    expect(failedRepo).toHaveAttribute('title', '链接检查失败，仍可尝试打开')
    expect(within(failedRepo).getByText('⚠')).toBeInTheDocument()

    // unknown（从未检查）：不降级，可访问名也不带失败说明
    const unknownSite = screen.getByRole('link', { name: '官网 · 演示项目（新窗口打开）' })
    expect(unknownSite.className).not.toContain('card-link--failed')
    expect(unknownSite).not.toHaveAttribute('title')
    expect(within(unknownSite).queryByText('⚠')).toBeNull()
  })

  it('F9 卡片侧：ok 与 null 同样不降级', () => {
    const okLink: Link = {
      id: 'l1',
      type: 'repo',
      label: 'GitHub',
      url: 'https://github.com/x/y',
      sort: 0,
      last_status: 'ok',
      last_http_status: 200,
      last_checked_at: '2026-10-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    }
    renderCard({ ...baseItem, links: [okLink] })
    const repo = screen.getByRole('link', { name: '仓库 · 演示项目（新窗口打开）' })
    expect(repo.className).not.toContain('card-link--failed')
    expect(within(repo).queryByText('⚠')).toBeNull()
  })

  it('卡片链接的可访问名来自标题，摘要仍在卡片内可读', () => {
    renderCard(baseItem)
    const link = screen.getByRole('link', { name: '演示项目' })
    expect(link).toHaveAttribute('href', '/projects/demo')
    expect(link).toHaveAttribute('aria-labelledby', 'project-card-title-p1')
    expect(screen.getByText('一句话摘要')).toBeInTheDocument()
  })

  it('非 http(s) 的链接地址降级为不渲染（防止 javascript: 注入）', () => {
    renderCard({
      ...baseItem,
      links: [
        {
          id: 'l1',
          type: 'repo',
          label: 'GitHub',
          url: 'javascript:alert(1)',
          sort: 0,
          last_status: 'ok',
          last_http_status: 200,
          last_checked_at: '2026-10-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'l2',
          type: 'site',
          label: '官网',
          url: 'https://demo.example.com',
          sort: 1,
          last_status: 'ok',
          last_http_status: 200,
          last_checked_at: '2026-10-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    expect(screen.queryByRole('link', { name: /仓库/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '官网 · 演示项目（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://demo.example.com',
    )
  })

  it('外部入口带项目名与新窗口提示，且 rel 完整', () => {
    renderCard({
      ...baseItem,
      links: [
        {
          id: 'l1',
          type: 'repo',
          label: 'GitHub',
          url: 'https://github.com/x/y',
          sort: 0,
          last_status: 'failed',
          last_http_status: 502,
          last_checked_at: '2026-10-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    // failed 链接仍可点，但可访问名里补了失败说明（F9 只降级 failed）
    const repo = screen.getByRole('link', { name: '仓库 · 演示项目（新窗口打开，链接检查失败）' })
    expect(repo).toHaveAttribute('target', '_blank')
    expect(repo).toHaveAttribute('rel', 'noopener noreferrer')
    const card = screen.getByRole('article')
    expect(within(card).getByText('★ 7')).toBeInTheDocument()
  })
})
