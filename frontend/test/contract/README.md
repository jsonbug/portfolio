# 契约联调套件（contract）

**同一张用例表，两个 runner**：`--source real` 打真后端，`--source mock` 把同一张表灌进 `frontend/src/mocks/handlers.ts`，`--source both` 逐行比对两者。同构不是声明的，是每次跑出来的。

- `run.mjs`：用例表本体（行记录），覆盖前台列表（分段计数 / 搜索 / 技术栈 / 排序 / 分页两类语义）、项目详情与 slug 301 / 可见性、笔记（N:1、`excerpt`、301、归档项目笔记不可见）。
- `frontend/src/mocks/contract-bridge.spec.ts`：mock runner，import 的是同一份 `run.mjs`，把行写到 `CONTRACT_ROWS_OUT` 供 `--source both` 比对。

## 断言写法两条通则（写/改断言前先读）

这两类坑会在任何测试集里反复长出来，不是本文件特有的：

1. **SKIP 不是 PASS**。条件不满足而没执行的分支只能打 `SKIP`，既不算通过也不算失败。把「跳过」记成通过，会让「永远 77 行绿」比「这次真跑了 60 行」更常见——绿色一旦不区分「验过」与「没验」，它就只是装饰。
2. **空集合上的断言不算断言**。`.every()` 在空数组上恒 true，`.some()` / `!(items ?? []).some(...)` 在空数组上恒 false，于是「列表接口返回空页」——最严重的一类回归——全绿。凡是要断「集合里每个都满足 P」或「集合里没有 X」，必须先有一条**非空前置断言**（`items.length > 0`）。

一句话判据：**一条断言只有在「功能坏掉时它会变红」时才算是断言**；看起来像检查但永远不会红的行，比没有检查更危险（在它旁边写 `// TODO` 也不行，读的人会假定这里已经有人守过）。

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

- **库身份自证**：脚本先打印 `BASE` 与 `/health` 结果，再建一个哨兵项目（写入 → 按 id 读回 → 软删），三者都通过才继续。这一步是为了防「默认端口撞上另一个工作区的后端，全套断言却全绿」——那种绿是假的。
- 校验过库身份后，脚本会**软删目标库里的所有既有项目**（保证计数断言确定），只对本地 `dev.db` 这种测试库用。
- **带 TODO 标注的红行 = 后端还没合，不是前端没改对**。`pendingBackend(name, 当前行为, 契约行为, 'backend:…')` 会断言「当前真实行为」并打 `✗ … TODO(backend:xxx)`，既不静默放行，也不把行从表里删掉；后端合入后该行自动变 `✓ …（后端已修，删掉本行 TODO 标注即可）`，前端同批把标注改成 `check()`。
- 当前带标注的：`search` 的 `%`/`_` 未转义（`fix/v1.2-review`）、`NoteSummary.excerpt` 未上线（契约 v1.2.3）。
- 表外抽样（不在 15 行对照表内，防「只对快照不对行为」）：`search` 超 200 字 → 400、`search=%` / `search=_` 字面量匹配、`stars` 同分回 `recent`、笔记 >100 篇（pageSize 上限 100 + 真实 `total`）。
- 公开项目详情**没有** `publish_status`，这是契约决定（可见性过滤后只剩 `published`，放开等于让前台表达它不该知道的状态）；所以详情页元数据里「发布状态」固定渲染「已发布」，归档项目的真实状态只属于后台。
- mock 侧同口径另有 `frontend/src/mocks/handlers.spec.ts` 单测；「两边同构」由 `--source both` 每次现场比对，不靠这句话担保。
