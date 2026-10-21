# frontend（项目展示平台 · 前台 + 后台界面）

Vue 3 + TypeScript + Vite 前端工程。与 `backend/`（Node.js + SQLite）并行开发。

## 技术栈

- Vue 3（组合式 API + `<script setup lang="ts">`）
- Vue Router（前台 `/`、后台 `/admin`）
- Pinia（状态管理）
- Vitest + @vue/test-utils + @testing-library/vue（测试）
- ESLint（flat config）+ Prettier

## 目录结构

```
src/
├── api/          # 数据获取层：通用 fetch 封装；契约冻结后按资源拆分 + 起 mock
├── assets/       # 需构建处理（导入）的静态资源
├── components/   # 可复用通用组件
├── composables/  # useXxx 组合式函数（纯逻辑优先，便于单测）
├── router/       # 路由：前台 / 与后台 /admin
├── stores/       # Pinia 全局状态
├── test/         # 测试 setup
├── types/        # 领域/契约类型（1.3 契约冻结后落地）
├── utils/        # 纯工具函数（含单测）
└── views/        # 页面（前台 + admin 后台）
```

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（默认 http://localhost:5173）
npm run typecheck  # vue-tsc 类型检查
npm run test       # Vitest 单测（一次运行）
npm run lint       # ESLint 检查
npm run build      # 类型检查 + 生产构建
```

## 约定

- 按「功能」而非「文件类型」组织目录；`.vue` 只负责渲染与交互，数据获取、纯计算、格式化、常量各自独立。
- 纯逻辑（composable、工具函数）直接单测；组件测试断言用户可见行为。
- 不使用 `v-html` 渲染不可信内容；不硬编码密钥或 token。
