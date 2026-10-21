# 契约联调套件（contract）

**同一张用例表，两个 runner**：`--source real` 打真后端，`--source mock` 把同一张表灌进 `frontend/src/mocks/handlers.ts`，`--source both` 逐行比对两者。同构不是声明的，是每次跑出来的。

- `run.mjs`：用例表本体（行记录），覆盖前台列表（分段计数 / 搜索 / 技术栈 / 排序 / 分页两类语义）、项目详情与 slug 301 / 可见性、笔记（N:1、`excerpt`、301、归档项目笔记不可见）。
- `frontend/src/mocks/contract-bridge.spec.ts`：mock runner，import 的是同一份 `run.mjs`，把行写到 `CONTRACT_ROWS_OUT` 供 `--source both` 比对。

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
> **4310 被占就换端口**，然后用 `CONTRACT_BASE_URL` 指过去；脚本开头会打印 `BASE` 并做库身份自证（见下），换端口不会悄悄打到别人库上。

## 跑

```bash
cd frontend
npm run contract                        # 只验真后端：必须项 + 带 TODO 标注的行（红行不阻断开退出码）
npm run contract -- --strict            # 带 TODO 标注的行也算失败（后端修完后用这个当门）
npm run contract -- --source mock       # 只验 mock（不需要后端）
npm run contract -- --source both       # 双向：同一张表两遍 + 逐行 diff（真不一致 → 退出码 1）
```

`--source both` 的判定：同名行逐条比「契约是否满足」。差异若发生在带 `TODO` 标注的行上（真实后端未合、mock 已按契约实现），列为 `⚠ 已知分叉` 不计失败；其余任何差异都算 `真不一致` 并退出 1。

可覆盖的环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CONTRACT_BASE_URL` | `http://127.0.0.1:4310/api/v1` | 后端 API 根地址 |
| `CONTRACT_ADMIN_USERNAME` | `admin` | 后台账号 |
| `CONTRACT_ADMIN_PASSWORD` | `integration-pass` | 后台密码 |

## 注意

- **库身份自证（P0，先于一切写操作）**：脚本先打印 `BASE` 与 `/health` 结果，再建一个哨兵项目（写入 → 按 id 读回 → 软删）。
  **四步里任何一步不成立，立即 `process.exit(3)`，不会进入下面的清场步骤**——清场会对库里所有项目发 `DELETE`，
  撞上别人的库就是把别人的数据软删掉，而红行还藏在输出最后一行。退出码约定：`1` 断言失败、`2` mock 侧取数失败、`3` 库身份未验明即中止。
- 校验过库身份后，脚本会**软删目标库里的所有既有项目**（保证计数断言确定），只对本地 `dev.db` 这种测试库用。
- **带 TODO 标注的红行 = 后端还没合，不是前端没改对**。`pendingBackend(name, 当前行为, 契约行为, 'TODO(<branch>)')` 会断言「当前真实行为」并打 `✗ … TODO(<branch>)`，既不静默放行，也不把行从表里删掉；后端合入后该行自动变 `✓ …（后端已修，删掉本行 TODO 标注即可）`，前端同批把标注改成 `check()`。
- **TODO 的 branch 必须是可校验的 git 分支名**（`backend:excerpt` 这类标签不接受）。校验命令（不进脚本——无网/无 git 的环境不该被卡死，由放行时人工跑一次）：

  ```bash
  grep -o 'TODO([^)]*)' frontend/test/contract/run.mjs | sed 's/TODO(//;s/)//' | sort -u \
    | xargs -r -n1 git ls-remote --exit-code --heads origin
  ```

- **已知分叉有硬上限**：`run.mjs` 里 `MAX_KNOWN_DIVERGENCES`（当前 `0`）被写死并断言，`--source both` 超出即把多出来的行算作「真不一致」。上限只会往下调，不放宽。
- 当前带标注的：**无**（`search` 的 `%`/`_` 与 `NoteSummary.excerpt` 都已合入，6 行归零）。
- 表外抽样（不在 15 行对照表内，防「只对快照不对行为」）：`search` 超 200 字 → 400、`search=%` / `search=_` 字面量匹配、`stars` 同分回 `recent`、笔记 >100 篇（pageSize 上限 100 + 真实 `total`）。
- 公开项目详情**没有** `publish_status`，这是契约决定（可见性过滤后只剩 `published`，放开等于让前台表达它不该知道的状态）；所以详情页元数据里「发布状态」固定渲染「已发布」，归档项目的真实状态只属于后台。
- mock 侧同口径另有 `frontend/src/mocks/handlers.spec.ts` 单测；「两边同构」由 `--source both` 每次现场比对，不靠这句话担保。
- `src/mocks/contract-bridge.spec.ts` 断言 **所有行（含 `kind==='todo'`）在 mock 侧必须 satisfied**：只查 `must` 会留「两侧同时违约即静默通过」的洞。
