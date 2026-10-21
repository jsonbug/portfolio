# 部署手册（Docker Compose）

两服务 + 同源反代：`api`（Fastify + Prisma/SQLite）与 `web`（nginx 托管前端产物，并把 `/api/v1` 反代到 `api:3000`）。前端与后端同源，因此**不需要 CORS，也不需要在前端写死后端地址**。

## 0. 前置要求

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Docker Engine | ≥ 24 | 本机实测 29.9.0 |
| Docker Compose | **≥ 2.30** | 需要 `env_file` 的 `format: raw`（见 §9 警告说明）；本机实测 v5.6.0 |
| Node.js | ≥ 20 | 仅用于在宿主机生成 `ADMIN_PASSWORD_HASH`（也可用容器内命令代替） |

不需要在宿主机安装 Node 依赖、Prisma 或数据库。

## 1. 相关文件

```
Dockerfile.api          后端镜像（多阶段；runtime = node:22-alpine，非 root）
Dockerfile.web          前端镜像（node:24-alpine 构建 → nginx:alpine 托管）
nginx.conf              nginx 主配置（SPA fallback + /api/v1 反代）
docker-compose.yml      两服务编排 + SQLite 命名卷 sqlite-data
.env.example            部署环境变量模板
.dockerignore           镜像构建上下文忽略规则
```

## 2. 首次部署

```bash
# 1) 环境变量
cp .env.example .env

# 2) 生成 JWT 密钥（写进 .env 的 AUTH_SECRET）
openssl rand -base64 48

# 3) 生成管理员口令摘要（写进 .env 的 ADMIN_PASSWORD_HASH，整行粘贴）
node backend/scripts/hash-password.mjs '你的强口令'

# 4) 构建并启动
docker compose up -d --build

# 5) 确认
docker compose ps                # 两个服务都应是 healthy
curl -s http://localhost:8080/api/v1/health

# 6) 全链路冒烟（登录 → 建项目 → 发布 → 前台可见 → 链接重检 → 软删恢复）
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs --base http://localhost:8080
```

打开 `http://<host>:8080/` 即前台；后台在 `/admin`（用 `ADMIN_USERNAME` + 上一步的明文口令登录）。

> 宿主 8080 被占用时：`.env` 里改 `WEB_PORT=8180`（或 `WEB_PORT=8180 docker compose up -d`），然后访问 `http://localhost:8180/`。

首次启动 api 会先执行 `prisma migrate deploy`，日志中可见：

```
3 migrations found in prisma/migrations
Applying migration `20261021113258_init`
Applying migration `20261021121009_add_cover_image`
Applying migration `20261021230000_v1_2_data_model`
All migrations have been successfully applied.
```

重启不会重复执行（`No pending migrations to apply.`），数据在命名卷 `sqlite-data` 里。

迁移失败则容器直接退出（不会带着旧 schema 提供服务）。

## 3. 起停与更新

```bash
docker compose up -d            # 启动/应用变更（按需重建容器）
docker compose stop             # 停止（保留容器与数据卷）
docker compose start            # 再启动
docker compose restart api      # 只重启后端（迁移幂等，会打印 No pending migrations）
docker compose down             # 删容器与网络，保留 SQLite 命名卷
docker compose down -v          # ⚠️ 连数据卷一起删（等于清库，慎用）

# 代码更新后
git pull && docker compose up -d --build
```

## 4. 数据库迁移

- 启动时自动 `prisma migrate deploy`，无需手工执行。
- 开发侧新增迁移：`cd backend && npx prisma migrate dev --name <name>`，把 `backend/prisma/migrations/` 提交后重新 `docker compose up -d --build`。
- `migrate deploy` 只前进不后退：**回滚靠恢复备份**（§6），不要在生产上跑 `migrate reset`。
- 手动查看迁移状态：`docker compose exec api npx prisma migrate status`。

## 5. 数据位置

- SQLite 文件：命名卷 `sqlite-data` 内的 `/data/prod.db`（`DATABASE_URL=file:/data/prod.db`）。
- 卷由 Docker 管理，`docker compose down` 不会删除；只有 `down -v` 才会。
- 定位卷在宿主机的真实路径：`docker volume inspect portfolio_sqlite-data --format '{{ .Mountpoint }}'`。

## 6. 备份与恢复

**备份**（一致性快照；停机窗口内执行最稳妥）：

```bash
docker compose stop api
mkdir -p backups
docker run --rm -v portfolio_sqlite-data:/data:ro -v "$PWD/backups":/backup alpine:3.20 \
  sh -c 'tar -czf /backup/prod-$(date +%Y%m%d-%H%M%S).tar.gz -C /data prod.db'
docker compose start api
ls -lh backups/
```

**恢复**：

```bash
docker compose stop api
docker run --rm -v portfolio_sqlite-data:/data -v "$PWD/backups":/backup alpine:3.20 \
  sh -c 'cd /data && rm -f prod.db prod.db-wal prod.db-shm && tar -xzf /backup/<备份文件名>.tar.gz'
docker compose start api
```

建议每日定时备份并把 `backups/` 同步到异地（`backups/` 已在 `.gitignore` 之外，请勿提交）。

## 7. 改管理员口令

```bash
# 1) 生成新摘要
node backend/scripts/hash-password.mjs '新口令'
# 2) 把 .env 里的 ADMIN_PASSWORD_HASH 整行替换为新值
# 3) 重建 api 容器（env 只在容器创建时注入）
docker compose up -d api
# 4) 验证：新口令 200、旧口令 401（已签发的旧 token 仍有效至过期，需要可同时轮换 AUTH_SECRET）
```

轮换 `AUTH_SECRET` 会让所有已签发 token 立即失效（改完同样 `docker compose up -d api`）。

## 8. 看日志

```bash
docker compose logs -f api          # 后端（pino JSON 结构化日志）
docker compose logs -f web          # nginx 访问/错误日志
docker compose logs --tail 100 api
docker compose logs api | grep '"level":50'   # 只看 error
docker compose exec web tail -f /var/log/nginx/access.log
```

排查顺序：`docker compose ps`（healthy?）→ `logs api`（迁移/启动失败）→ `curl /api/v1/health` 直连后端 → `curl /api/v1/health` 走 nginx。

## 9. 安全与已知提示

- **密钥不进镜像**：`AUTH_SECRET` / `ADMIN_PASSWORD_HASH` 只在运行时经 `env_file` 注入；镜像层与 Dockerfile 中无任何密钥，`.env` 已被 `.gitignore` 忽略。
- **非 root 运行**：api 容器以 `node`(uid 1000) 运行，`/data` 属主为 `node`。
- **compose 的 `variable is not set` 警告**：`ADMIN_PASSWORD_HASH` 形如 `scrypt$<salt>$<hash>`，compose 会把它当变量插值（把 `$fc18…` 替换成空串，导致登录永远 401）。因此 `docker-compose.yml` 使用了 `env_file: { path: .env, format: raw }` 原样注入。compose 读取 `.env` 作为项目环境时仍会打印该警告，**属无害噪音**，可用下面的命令确认容器内取值与 `.env` 完全一致：

  ```bash
  docker compose exec api printenv ADMIN_PASSWORD_HASH
  grep '^ADMIN_PASSWORD_HASH=' .env | cut -d= -f2-
  ```

  若把 `format: raw` 去掉，这两行会不一致（后者多出的 `$<hash>` 段丢失）。

## 10. 前置反向代理与 HTTPS（待域名落地）

容器自身只监听 HTTP `:8080`，TLS 交给前置反代。dash 提供域名后按下面任一方案接：

**Caddy（最省事，自动签发/续期证书）**

```caddyfile
portfolio.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

改 `WEB_PORT=127.0.0.1:8080`（只监听回环，避免绕过 TLS 直连），并注意 Caddy 反代到 nginx 后 nginx 需收到正确的 `Host` 与 `X-Forwarded-Proto`（Caddy 默认已传）。上限：`client_max_body_size 10m` 在容器内 nginx 已设，若要传更大笔记需同时调整。

**nginx + certbot**

```nginx
server {
  listen 443 ssl;
  server_name portfolio.example.com;
  ssl_certificate     /etc/letsencrypt/live/portfolio.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/portfolio.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server {
  listen 80;
  server_name portfolio.example.com;
  return 301 https://$host$request_uri;
}
```

上线后需回归：`/api/v1/health`、登录、前台列表/详情、Markdown 笔记渲染、静态资源缓存（`/assets/*` immutable）。

## 11. 受限网络下的构建，与一键冒烟

### 11.1 构建期需要外网的两处（都是可绕过的）

| 步骤 | 依赖 | 拿不到时的后果 |
| --- | --- | --- |
| `apk add --no-cache openssl` | Alpine CDN | Dockerfile 里**已容错**：拉不到只打一行 WARN 继续。`node:22-alpine` 自带 `libssl.so.3` / `libcrypto.so.3`，prisma 引擎可正常用 |
| `npx prisma generate`（builder 阶段） | `binaries.prisma.sh` | 引擎下载不到则**构建失败**（这一步没法容错，引擎是运行时必需） |

`npm ci` 需要能访问 npm registry。离线/内网构建的做法：在有网机器上 `docker save` 两个镜像（`portfolio-api:local` / `portfolio-web:local`）带进内网 `docker load`，再用 `docker compose up -d --no-build` 起（`image:` 名字已固定，不需要重新构建）。

### 11.2 一键冒烟脚本

`scripts/smoke-compose.mjs`：对已起来的一套环境跑完整业务链路，约 70 条断言，失败项逐条打印并返回非 0。

```bash
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs              # 默认 http://localhost:8080
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs --base http://localhost:8180 --slug my-run
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs --public      # 额外做一次真实外网链接重检
```

覆盖：nginx 静态托管与 `/projects`、`/admin/*` 的 history fallback → `/api/v1` 同源反代（含 `Authorization` 透传）→ 登录 / 401 → 建草稿项目（含链接与笔记）→ 草稿对前台不可见 → 发布后列表/详情/笔记可见 → 后台分段计数与过滤 → 元数据 KV（整体替换 + 重复键名 400）→ B16 链接重检（私网目标必须判 `failed` 且 `last_http_status` 为 null）→ 软删/恢复/`includeDeleted` → 契约错误信封与状态机。

它只读 `--base` 指向的入口、只用标准库 fetch，不接外网（除 `--public`）。CI 的 `compose` job 会跑同一份脚本。

### 11.3 链接健康检查相关变量

`LINK_CHECK_ENABLED` / `LINK_CHECK_TIMEOUT_MS` / `LINK_CHECK_TOTAL_TIMEOUT_MS` / `LINK_CHECK_MAX_REDIRECTS`，都走 `.env`（`env_file` 原本就整份注入），不填用默认值。SSRF 拦截不可关闭：私网/环回/云元数据地址一律直接记 `failed`，且不发出任何请求；后台 UI 只显示「链接不可访问」，被拦原因只进服务端日志。

### 11.4 启动期配置校验

`AUTH_SECRET` 少于 32 字节、用了 dev 占位串、`AUTH_TTL_SECONDS` 非正整数、`ADMIN_PASSWORD_HASH` 不是 `scrypt$<salt>$<hash>` 格式时，api 容器**直接拒绝启动**并打印处理办法，例如：

```
Error: [env] 生产配置校验失败，拒绝启动：
  · ADMIN_PASSWORD_HASH：不是 scrypt$<salt>$<hash> 格式（常见原因：compose 把 `$` 后面的段插值吃掉了，或粘贴不完整）；处理：node backend/scripts/hash-password.mjs '你的口令' 重新生成并整行粘贴；compose 的 env_file 必须保留 format: raw
```

这样 §9 里那个「登录永远 401」的坑会在启动时就暴露，而不是让管理员反复试密码。
