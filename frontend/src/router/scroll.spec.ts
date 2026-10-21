import type { RouteLocationNormalized } from 'vue-router'
import { describe, expect, it } from 'vitest'
import router from './index'

/** `router.resolve()` 给的类型少一个必填 name，测试里补个空壳即可。 */
const at = (path: string): RouteLocationNormalized => router.resolve(path) as unknown as RouteLocationNormalized

/**
 * P2-6：路由切换回顶部，但带 hash 的导航（目录锚点）交给浏览器自己滚。
 * 这里直接取 router 配置里的 scrollBehavior 断言，不依赖真实窗口滚动。
 */
describe('scrollBehavior', () => {
  const behavior = router.options.scrollBehavior!

  it('普通路由切换回到顶部', () => {
    const to = at('/projects/demo')
    expect(behavior(to, at('/'), null)).toEqual({ top: 0 })
  })

  it('带 hash 的导航不做处理（交给浏览器滚到锚点）', () => {
    const to = at('/notes/a#heading-1')
    expect(behavior(to, at('/notes'), null)).toEqual({})
  })

  it('浏览器前进/后退优先恢复保存的位置', () => {
    const to = at('/notes')
    expect(behavior(to, at('/'), { left: 0, top: 480 })).toEqual({ left: 0, top: 480 })
  })
})
