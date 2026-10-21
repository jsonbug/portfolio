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

### 4.1 迁移中途失败（半迁移）的唯一可靠路径

SQLite 下**迁移文件不是原子执行**（Prisma 也不会把多文件包进一个事务）：一个文件里有两条语句、
或者一批迁移中途失败，库里就可能停在「表建了、索引没建」或「ALTER 做了、后一步没做」的状态。
此时 `migrate deploy` 会一直失败，而 **`resolve --rolled-back` 单独救不了它**——它只把记录标成
「已回滚」，库里的表/列还在，重跑就报 `table already exists` / `duplicate column name`。
这一点用真库演练过（2026-10 截图迁移批），不是推测。

唯一可靠的恢复路径（四步，顺序不能变）：

```bash
# 1. 停 api（避免启动时又跑一次 deploy）+ 恢复备份：连 -wal / -shm 一起删掉
#    （SQLite 的 WAL 里可能还有未 checkpoint 的页，只换 .db 文件会配上一个旧的 -wal）
docker compose stop api
cd "$(docker volume inspect portfolio_sqlite-data --format '{{ .Mountpoint }}')"
cp prod.db.bak-20261022T101500 prod.db
rm -f prod.db-wal prod.db-shm

# 2. 把失败的那条（或那批）迁移标成已回滚
cd - && docker compose run --rm api npx prisma migrate resolve --rolled-back 20261022130200_project_screenshots_index

# 3. 确认状态：失败项应该回到 pending，没有 failed 残留
docker compose run --rm api npx prisma migrate status

# 4. 修因（改迁移 SQL 或改镜像）后再 deploy
docker compose run --rm api npx prisma migrate deploy
docker compose up -d
```

**不要手工补列/补表再 `resolve --rolled-back`。** 那会让库结构与迁移记录对不上：下一份
迁移可能重复加同一个列而失败，或者更糟——记录说「没跑过」、库说「已经有了」，两种状态都没人验过。
手改库只允许在「已经从备份恢复」之后进行。

为此约定：**一个迁移文件只放一条语句**（建表与建索引分开），把非原子窗口缩到最小。

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
| `prisma generate` / prisma 引擎运行 | 基础镜像自带的 `libssl.so.3`（不是 `openssl` 包） | Dockerfile 里是**构建期断言**：`test -e /usr/lib/libssl.so.3`，缺了**直接构建失败**（不放行，否则容器里 prisma 会崩）。`openssl` **CLI** 不是运行时依赖——应用与 prisma 引擎都不调它，只有本文档里「`openssl rand` 生成密钥」这条人工命令用到，在宿主上执行即可，镜像里不装 |
| `npx prisma generate`（builder 阶段） | `binaries.prisma.sh` | 引擎下载不到则**构建失败**（这一步没法容错，引擎是运行时必需） |

`npm ci` 需要能访问 npm registry。离线/内网构建的做法：在有网机器上 `docker save` 两个镜像（`portfolio-api:local` / `portfolio-web:local`）带进内网 `docker load`，再用 `docker compose up -d --no-build` 起（`image:` 名字已固定，不需要重新构建）。

### 11.2 一键冒烟脚本

`scripts/smoke-compose.mjs`：对已起来的一套环境跑完整业务链路，约 100 条断言，失败项逐条打印并返回非 0。

```bash
LINK_CHECK_ENABLED=0 docker compose up -d       # 冒烟前先这样起：别让脚本在你的机器上触发外网检查
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs              # 默认 http://localhost:8080
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs --base http://localhost:8180 --slug my-run
ADMIN_PASSWORD='你的强口令' node scripts/smoke-compose.mjs --public      # 额外做一次真实外网链接重检
```

覆盖：nginx 静态托管与 `/projects`、`/admin/*` 的 history fallback → `/api/v1` 同源反代（含 `Authorization` 透传）→ 登录 / 401 → 建草稿项目（含链接与笔记）→ 草稿对前台**不可见**（先造一个已发布项目保证列表非空，再断否定命题）→ 发布后列表/详情/笔记可见（含 `excerpt` 正向前断）→ 技术栈过滤、进展分段过滤、`sort=recent` 降序（断内容而非只断 200）→ 后台分段计数与过滤、后台笔记状态 → 元数据 KV 与截图（断内容）→ 软删/恢复/`includeDeleted` → 契约错误信封（`VALIDATION_ERROR` / `INVALID_STATUS_TRANSITION`）与状态机。

关于外网：脚本**自己**不发任何外网请求，但后端「建链接时自动检查」默认开启（`backend/src/lib/link-check.ts:251`，`NODE_ENV=test` 或 `LINK_CHECK_ENABLED=0` 关闭），所以**起栈时要显式 `LINK_CHECK_ENABLED=0`**——否则建链接那一刻后端会真的去连一次外网，在受限网络里把该链接记成 `failed`（不影响判定，但库里留脏状态）。`--public` 是唯一显式要求出网的分支。

关于数据：脚本默认在结尾软删自己建的项目（避免在被复用的库上累积脏数据）；调试时加 `--keep-data` 保留。**它是写操作**，只应在一次性/可回收的库上跑（`docker compose down -v` 后重建即干净）。

关于输出：`PASS`/`FAIL`/`SKIP` 三类分开计。`SKIP` 是「这条没执行」，**不计入通过也不计入失败**——把跳过印成 PASS 会让绿色失去意义。CI 的 `compose` job 跑同一份脚本（不带 `--public`）。

**每次上线后手工跑一次 `--public`**：公网链接重检依赖外部站点可达性，放进 CI 只会得到随机红，所以它是发布流程的一个手工步骤，不是 CI 检查项。CI 里那行 `SKIP` 说明保留着，就是为了让人看见「这里少跑了一条」。

> 先确认你访问的确实是这套容器：`docker compose port web 80` 与 `ss -ltn | grep <端口>` 对一下。
> 宿主机上别的服务若占了同一个端口（本机就是 Trilium 占着 `127.0.0.1:8080`），`curl localhost:8080` 会打到它，
> 报出来的还是「接口 404」，很容易误判成后端没注册路由。

### 11.3 链接健康检查相关变量

`LINK_CHECK_ENABLED` / `LINK_CHECK_TIMEOUT_MS` / `LINK_CHECK_TOTAL_TIMEOUT_MS` / `LINK_CHECK_MAX_REDIRECTS`，都走 `.env`（`env_file` 原本就整份注入），不填用默认值。SSRF 拦截不可关闭：私网/环回/云元数据地址一律直接记 `failed`，且不发出任何请求；后台 UI 只显示「链接不可访问」，被拦原因只进服务端日志。

### 11.4 启动期配置校验

`AUTH_SECRET` 少于 32 字节、用了 dev 占位串、`AUTH_TTL_SECONDS` 非正整数、`ADMIN_PASSWORD_HASH` 不是 `scrypt$<salt>$<hash>` 格式时，api 容器**直接拒绝启动**并打印处理办法，例如：

```
Error: [env] 生产配置校验失败，拒绝启动：
  · ADMIN_PASSWORD_HASH：不是 scrypt$<salt>$<hash> 格式（常见原因：compose 把 `$` 后面的段插值吃掉了，或粘贴不完整）；处理：node backend/scripts/hash-password.mjs '你的口令' 重新生成并整行粘贴；compose 的 env_file 必须保留 format: raw
```

这样 §9 里那个「登录永远 401」的坑会在启动时就暴露，而不是让管理员反复试密码。

分环境行为（避免把本地开发和 CI 一起打死）：`NODE_ENV=production` **硬拒启动**；非生产环境只 **WARN**（逐项列原因）并在登录 401 的 message 里附一句「服务端配置校验未通过」；显式给 `ALLOW_WEAK_SECRET=1` 才在非生产放行，且**仍然打 WARN**（逃逸必须留痕，否则等于没有）。
