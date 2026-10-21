/**
 * 后台项目列表的列配置（一张表 + 一条规则，代替散落在 media query 里的 display:none）。
 *
 * 为什么是数据：加第 8 列时只需要在表里插一行并给它 `minWidth`，隐列顺序自动成立；
 * 顺序也不再靠 CSS 源码里的先后，而是 `PROJECT_LIST_COLUMNS` 的数组顺序 —— 断言可以直接读它。
 *
 * 规则（gap §四）：**从右往左逐列隐藏**，`minWidth` 大的先消失；`minWidth: 0` 表示任何宽度都不隐藏。
 */

export type ProjectColumnKey =
  | 'name'
  | 'slug'
  | 'publish_status'
  | 'progress'
  | 'links'
  | 'updated_at'
  | 'actions'

export interface ProjectColumn {
  key: ProjectColumnKey
  /** 表头文案（与效果图一致） */
  label: string
  /** 视口 ≥ 该值才显示；0 = 永不隐藏。数值越大越先被隐藏（= priority） */
  minWidth: number
  /** 列宽样式类 */
  className: string
}

/** 展示顺序即数组顺序：名称 → slug → 发布状态 → 进展 → 链接 → 更新时间 → 操作。 */
export const PROJECT_LIST_COLUMNS: readonly ProjectColumn[] = [
  { key: 'name', label: '名称', minWidth: 0, className: 'col-name' },
  { key: 'slug', label: 'slug', minWidth: 384, className: 'col-slug' },
  { key: 'publish_status', label: '发布状态', minWidth: 0, className: 'col-status' },
  { key: 'progress', label: '进展', minWidth: 512, className: 'col-progress' },
  { key: 'links', label: '链接', minWidth: 0, className: 'col-links' },
  { key: 'updated_at', label: '更新时间', minWidth: 640, className: 'col-updated' },
  { key: 'actions', label: '操作', minWidth: 768, className: 'col-actions' },
]

/** 指定视口宽度下应显示的列（保持展示顺序，不会重排）。 */
export function visibleColumns(width: number): ProjectColumn[] {
  return PROJECT_LIST_COLUMNS.filter((column) => width >= column.minWidth)
}

/** 指定视口宽度下被隐藏的列（调试/测试/排障用）。 */
export function hiddenColumns(width: number): ProjectColumn[] {
  return PROJECT_LIST_COLUMNS.filter((column) => width < column.minWidth)
}

/** 所有断点（从宽到窄），用于文档与用例逐一覆盖。 */
export const COLUMN_BREAKPOINTS: readonly number[] = [
  ...new Set(PROJECT_LIST_COLUMNS.map((column) => column.minWidth).filter((width) => width > 0)),
].sort((a, b) => b - a)
