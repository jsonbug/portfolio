/**
 * 极简 debounce（搜索框 300ms）：最后一次调用后 `wait` 毫秒才执行。
 * 附带 `cancel()`，组件卸载或提交表单时用来丢弃待执行调用。
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel: () => void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = ((...args: A) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }) as Debounced<A>

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  return debounced
}
