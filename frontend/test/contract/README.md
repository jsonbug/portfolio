# 契约联调套件（contract）

拿**真实后端**逐条验证前端依赖的契约点，用来给 `frontend/src/mocks/handlers.ts`（手写的契约副本）对准方向。

- `run.mjs`：一次性跑的断言脚本，覆盖前台列表（分段计数 / 搜索 / 技术栈 / 排序 / 分页）、项目详情与 slug 301 / 可见性、笔记（N:1、`excerpt`、301、归档项目笔记不可见）。

## 前置条件

1. 后端在本地起着，默认地址 `http://127.0.0.1:4310/api/v1`：

   ```bash
   cd backend
   npm ci
   npx prisma migrate deploy
   npx prisma generate
   # ADMIN_PASSWORD_HASH 用 node scripts/hash-password.mjs <密码> 生成，写进 backend/.env
   PORT=4310 npx tsx src/index.ts
   ```

2. 账号密码与上面的 `ADMIN_USERNAME` / 密码一致（默认 `admin` / `integration-pass`）。

> 端口别用 3000：本机 3000 常被别的服务占着，返回的是 `{"error":"Authentication required."}`，不是本项目后端。

## 跑

```bash
cd frontend
npm run contract             # 契约必须项 + 已知缺口（缺口只告警，退出码 0）
npm run contract -- --strict # 已知缺口也当失败（后端修完后用这个当门）
```

可覆盖的环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CONTRACT_BASE_URL` | `http://127.0.0.1:4310/api/v1` | 后端 API 根地址 |
| `CONTRACT_ADMIN_USERNAME` | `admin` | 后台账号 |
| `CONTRACT_ADMIN_PASSWORD` | `integration-pass` | 后台密码 |

## 注意

- 脚本开头会**软删目标库里的所有既有项目**（保证计数断言确定），只对本地 `dev.db` 这种测试库用。
- 已知后端缺口（`?search=%` 未转义、`page` 越界返回 200 空页）在修复前以 `⚠` 告警，不阻塞；后端 `fix/v1.2-review` 落地后应转绿。
- mock 侧同口径由 `frontend/src/mocks/handlers.spec.ts` 守住；这套脚本守的是「mock 与真实后端同构」。
