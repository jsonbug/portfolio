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
