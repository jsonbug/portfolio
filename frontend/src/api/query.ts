/**
 * 查询字符串构造：数组按重复参数展开（`technology=Vue&technology=TypeScript`），
 * 与后端 `@fastify` 的 `qs` 解析保持一致；空串/undefined/null 不下发。
 */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number>

export function buildQueryString(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue
        params.append(key, String(item))
      }
      continue
    }
    params.set(key, String(value))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}
