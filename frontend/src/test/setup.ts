import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/vue'
import { afterEach } from 'vitest'

// 每个用例后卸载组件，避免多个渲染结果在 document 中叠加。
afterEach(() => {
  cleanup()
})
