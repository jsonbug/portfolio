import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 基路径：默认挂在根。挂到路由器前缀（如 /apps/portfolio/）时用 VITE_BASE 注入，
  // 构建产物里的资源路径与 vue-router 的 history base 都跟着走（见 router/index.ts 的 import.meta.env.BASE_URL）。
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 联调骨架：后端就绪后取消注释，把 /api 代理到后端服务。
    // 具体地址以后端脚手架（1.1 后端）实际端口为准。
    // proxy: {
    //   '/api': {
    //     target: 'http://localhost:3000',
    //     changeOrigin: true,
    //   },
    // },
  },
})
