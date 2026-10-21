/**
 * 前台列表的筛选条件：唯一真源是 URL query（可分享、可前进后退）。
 * 这里只做「query ↔ 结构体」的纯转换，方便单测与复用。
 */
import type { LocationQueryRaw } from 'vue-router'
import { PROGRESS_LABELS, type Progress, type ProjectSort } from '@/types'

export interface ProjectListFilters {
  /** 搜索词（匹配名称与简介）。 */
  q: string
  /** 技术栈多选，命中任一即匹配。 */
  tech: string[]
  /** 分段：null = 全部（无「已归档」分段）。 */
  progress: Progress | null
  sort: ProjectSort
}

export interface SegmentOption {
  value: Progress | null
  label: string
}

/** 三个分段，顺序固定；计数来自后端 `counts`（progress 过滤前统计）。 */
export const SEGMENTS: SegmentOption[] = [
  { value: null, label: '全部' },
  { value: 'ongoing', label: '进行中' },
  { value: 'launched', label: '已上线' },
]

export const SORT_OPTIONS: Array<{ value: ProjectSort; label: string }> = [
  { value: 'recent', label: '最近更新' },
  { value: 'stars', label: 'Star 最多' },
]

/** 默认值不写进 URL，保持链接干净。 */
export const DEFAULT_FILTERS: ProjectListFilters = {
  q: '',
  tech: [],
  progress: null,
  sort: 'recent',
}

/** URL 侧收口（URL 是唯一真源，所以边界必须住在这个纯函数里，手改 URL 也挡得住）。 */
export const MAX_QUERY_LENGTH = 200
export const MAX_TECH_NAME_LENGTH = 50
export const MAX_TECH_COUNT = 20

const PROGRESS_VALUES = Object.keys(PROGRESS_LABELS) as Progress[]
const SORT_VALUES = SORT_OPTIONS.map((o) => o.value)

function asArray(value: LocationQueryRaw[string]): string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v): v is string => typeof v === 'string')
}

/** 解析 URL query；非法值静默忽略（不抛错、不阻塞首次渲染）。 */
export function parseFilters(query: LocationQueryRaw): ProjectListFilters {
  const q = asArray(query.q).join(' ').trim().slice(0, MAX_QUERY_LENGTH)
  const tech = [
    ...new Set(
      asArray(query.tech)
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        // 超长技术栈名不可能是后台维护的值，直接丢弃（而不是截断成另一个名字）
        .filter((v) => v.length > 0 && v.length <= MAX_TECH_NAME_LENGTH),
    ),
  ].slice(0, MAX_TECH_COUNT)
  const rawProgress = asArray(query.progress)[0]
  const progress =
    rawProgress && (PROGRESS_VALUES as string[]).includes(rawProgress)
      ? (rawProgress as Progress)
      : null

  const rawSort = asArray(query.sort)[0]
  const sort =
    rawSort && (SORT_VALUES as string[]).includes(rawSort) ? (rawSort as ProjectSort) : 'recent'

  // 技术栈按字典序稳定排序，避免同一组筛选生成不同 URL（影响缓存与分享）。
  const sortedTech = [...tech].sort((a, b) => a.localeCompare(b))

  return { q, tech: sortedTech, progress, sort }
}

/** 结构体 → URL query（省略默认值）。 */
export function toQuery(filters: ProjectListFilters): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (filters.q.trim()) query.q = filters.q.trim()
  if (filters.tech.length) query.tech = [...filters.tech].sort((a, b) => a.localeCompare(b))
  if (filters.progress) query.progress = filters.progress
  if (filters.sort !== DEFAULT_FILTERS.sort) query.sort = filters.sort
  return query
}

/** 是否是默认（无筛选）状态 —— 决定「清除筛选」是否出现。 */
export function isDefaultFilters(filters: ProjectListFilters): boolean {
  return (
    filters.q.trim() === '' &&
    filters.tech.length === 0 &&
    filters.progress === null &&
    filters.sort === DEFAULT_FILTERS.sort
  )
}
