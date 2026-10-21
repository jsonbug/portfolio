/**
 * 截断文本并追加省略号（用于列表摘要等场景）。
 *
 * @param text 原文
 * @param maxLength 最大长度（含省略号）
 */
export function truncate(text: string, maxLength: number): string {
  if (maxLength < 1) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * 把 ISO 日期字符串格式化为 `YYYY-MM-DD`（用于「更新时间」等展示）。
 *
 * 统一按 UTC 解析，保证输出不随运行环境时区漂移；如需按访问者本地时区展示，另行调整。
 */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/**
 * 距今天数（整数，向下取整，未来时间夹到 0）。
 *
 * @param iso ISO 日期字符串，null / 非法值返回 null
 * @param now 当前时间戳（毫秒），便于测试注入
 */
export function daysAgo(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((now - time) / 86_400_000))
}

/**
 * 粗估阅读时长（分钟）：中文按字、英文按词，300 单位/分钟取整，至少 1 分钟。
 *
 * 只用于笔记页的「阅读时长」提示，不必精确。
 */
export function readingTimeMinutes(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const words = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z0-9]+/g) ?? []).length
  const units = cjk + words
  if (units === 0) return 0
  return Math.max(1, Math.round(units / 300))
}

/** 搜索词上限：与契约的 `search` 参数上限一致（输入框 maxlength 与 URL 侧共用同一常量）。 */
export const MAX_SEARCH_LENGTH = 200

/**
 * 搜索词收口：去首尾空白并截到 `MAX_SEARCH_LENGTH`。
 *
 * 输入框（`<input type="search">` 的 commit）与 URL query 解析都走这里，
 * 避免「地址栏贴长串」和「输入框手打」得到两种长度。
 */
export function clampSearch(value: string | null | undefined): string {
  return (value ?? '').trim().slice(0, MAX_SEARCH_LENGTH)
}
