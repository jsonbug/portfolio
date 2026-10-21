# Portfolio（项目展示平台）

展示个人开发项目的平台：前台公开展示项目、笔记、元数据与链接，后台进行管理。

## 结构

```
portfolio/
├── backend/             # Node.js + Fastify + Prisma（SQLite，预留迁 PostgreSQL/Supabase）
├── frontend/            # Vue 3 + Vite + TypeScript
├── docs/                # API 契约与数据模型
└── .github/workflows/   # CI + 部署骨架
```

## 目录说明

- `backend/` — 后端服务：REST API、JWT 认证、SQLite 数据层（Prisma），含单元/集成测试
- `frontend/` — 前端应用：前台公开页（项目列表/详情）+ 后台管理（登录/项目/链接/笔记），详见 `frontend/README.md`
- `docs/` — `api-contract.md`（API 契约）、`data-model.md`（数据模型）

## 本地开发

后端（默认 3000 端口，`PORT` 可覆盖）：

```bash
cd backend
npm install
npm run dev
```

前端（默认 5173 端口）：

```bash
cd frontend
npm install
npm run dev
```

## CI

`.github/workflows/ci.yml` 两个 job 各自 `working-directory`：

- `frontend`：lint / typecheck / test / build
- `backend`：prisma validate / typecheck / lint / test

`deploy.yml` 为部署骨架（当前仅构建前端并产出产物，阶段 4 上线前追加对应 provider 的发布步骤）。
