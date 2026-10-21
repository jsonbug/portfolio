import { ref, type Ref } from 'vue'

export interface UnsavedChangesGuard {
  /** 是否展示「未保存的修改」浮层。 */
  showLeavePrompt: Ref<boolean>
  /** 有未保存修改时挂起导航并等待用户选择；无修改直接放行。 */
  ask: () => Promise<boolean>
  /** 用户选择留下继续编辑：取消这次导航。 */
  stayHere: () => void
  /** 用户选择放弃并离开：放行这次导航。 */
  confirmLeave: () => void
}

/**
 * 「未保存改动」离开拦截。
 *
 * 数据源只有一个布尔：表单快照与当前值是否相同（由调用方用 computed 提供）。
 * 守卫侧写 `const proceed = await guard.ask(); return proceed`，不要自己维护第二份状态——
 * 第二份状态一定会与表单漂开，进而出现「提示闪一下就没了」或「拦住了但按钮没反应」。
 */
export function useUnsavedChanges(dirty: Ref<boolean>): UnsavedChangesGuard {
  const showLeavePrompt = ref(false)
  let decide: ((proceed: boolean) => void) | null = null

  function ask(): Promise<boolean> {
    if (!dirty.value) return Promise.resolve(true)
    showLeavePrompt.value = true
    return new Promise<boolean>((resolve) => {
      decide = resolve
    })
  }

  function settle(proceed: boolean) {
    showLeavePrompt.value = false
    decide?.(proceed)
    decide = null
  }

  return {
    showLeavePrompt,
    ask,
    stayHere: () => settle(false),
    confirmLeave: () => settle(true),
  }
}
