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
npm run contract                        # 只验真后端（表里只有 must 行，恒严格）
npm run contract -- --source mock       # 只验 mock（不需要后端）
npm run contract -- --source both       # 双向：同一张表两遍 + 逐行 diff（任何不一致 → 退出码 1）
```

`--source both` 的判定：同名行逐条比「契约是否满足」。**任何一行结论不同都算「真不一致」并退出 1**——没有「已知分叉」豁免通道。

> `--strict` 参数还认，但已经不再改变结果：整张表只有 `must` 行（结构断言 `assertNoTodoRows` 保证），
> 任何一行不满足都是失败。想加回「等后端合」的行，必须先删掉那条断言——删断言在 diff 里看得见，
> 比改一个常量显眼。

可覆盖的环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CONTRACT_BASE_URL` | `http://127.0.0.1:4310/api/v1` | 后端 API 根地址 |
| `CONTRACT_ADMIN_USERNAME` | `admin` | 后台账号 |
| `CONTRACT_ADMIN_PASSWORD` | `integration-pass` | 后台密码 |

## 注意

- **库身份自证（P0，先于一切写操作）**：脚本先打印 `BASE` 与 `/health` 结果，再建一个哨兵项目（写入 → 按 id 读回 → 软删）。
  **四步里任何一步不成立，立即 `process.exit(3)`，不会发出任何写请求**——之后的清场只软删本次 `RUN-` 前缀的项目，
  但撞上别人的库时连这条也不该发，而红行还藏在输出最后一行。退出码约定：`1` 断言失败、`2` mock 侧取数失败、`3` 库身份未验明即中止。
- **没有「已知分叉」机制**：`pendingBackend()`、`kind==='todo'` 分支与 `MAX_KNOWN_DIVERGENCES` 都已删除，
  取而代之的是结构断言「整张表只能是 `must`」。理由是 abuse 通道不能靠常量守——常量可以改大，留一个函数就能标一打 TODO。
- 清场**只删本次 RUN 前缀的项目**（`cleanupRunProjects()`），不再发全局 reset：身份自证只能证明「库能读能写」，
  不能证明「库专属于我」；全局清场在端口撞车时就是删别人的数据。因此计数断言全部改成「基线 + 本次增量」
  （脚本开头打印基线），顺序类断言只在自己这批（`RUN-` 前缀）上判。
- **收尾与开头的清场同源**：CLI 在 `try/finally` 里再调一次 `cleanupRunProjects()`，脚本自己建的 `RUN-` 项目自己收，
  不让本机库无限累积测试项目；断言失败、抛错、mock 侧取数失败都走同一条 finally。
- 表外抽样（不在 15 行对照表内，防「只对快照不对行为」）：`search` 超 200 字 → 400、`search=%` / `search=_` 字面量匹配、`stars` 同分回 `recent`、笔记 >100 篇（pageSize 上限 100 + 真实 `total`）。
- 后台列表项的**键集合**由一行断言固定（契约 §4.1，含 `note_count`）：mock 少一个字段、真后端多一个字段都会红。
- 后台 320 宽专项**不在本表范围**：`docs/frontend-gap-v1.2.md` 要求的最小宽是 768，320 属范围外，不为它单开用例（列优先级表从 768 往下不再给断点）。
- 公开项目详情**没有** `publish_status`，这是契约决定（可见性过滤后只剩 `published`，放开等于让前台表达它不该知道的状态）；所以详情页元数据里「发布状态」固定渲染「已发布」，归档项目的真实状态只属于后台。
- mock 侧同口径另有 `frontend/src/mocks/handlers.spec.ts` 单测；「两边同构」由 `--source both` 每次现场比对，不靠这句话担保。
- `src/mocks/contract-bridge.spec.ts` 断言 **所有行在 mock 侧必须 satisfied**；`--source both` 也断言两侧都只有 `must` 行。
  只查某一类行会留「两侧同时违约即静默通过」的洞——那对「都错」和「都对」给出同一结果。

## 覆盖到 §4.1.1（截图 / 元数据 kind）

- 截图段落断言：条目的键集合、`sort` 按下标补齐、`caption` 裁剪且空白归一 `null`、`[]` 清空、11 张 → 400、`https://`（无 host）→ 400、无截图项目是 `[]` 而不是 `null`。
- 元数据段落断言：`kind` 缺省 `meta`、公开详情也带 `kind`、第 3 条 `metric` → 400。
- **这一轮靠这张表抓到一个真 bug**：`PUT /admin/projects/:id/metadata` 的 body 是**裸数组**，前端曾经发 `{ items: [...] }` → 真后端一律 400，而 mock 侧因为自己也按 `{items}` 实现，整套 277 条前端用例都绿。mock 是手写的契约副本，这类「两边一起错」只有真后端能戳穿。

## 本表不覆盖

这张表全绿只说明**下面这些协议面同构**，不等于「前后端完全同构」。以下明确不在覆盖范围，别把绿读成全域结论：

| 未覆盖 | 原因 / 现状 |
|---|---|
| **错误体内容**（`error.message` 文案、`details[].code` 取值） | 只断言 `error.code` 与 `details[]` 的**键结构**（`field`/`code`/`message`）；文案与词表不承诺稳定，不比对 |
| `GET /technologies` 的排序与去重 | 只断言「含可见项目的技术栈、不含不可见项目的」与「码点升序无重复」；与后台标签的排序一致性无断言 |
| 后台两类列表（`/admin/projects`、`/admin/notes`）的 `search` | 契约 3.7 已标 ⚠️ 仍走未转义的 SQL `LIKE`，两侧都未按字面量匹配 |
| 截图 `screenshots[]` 与元数据 `kind('meta'｜'metric')` | 契约条文已写，可执行行施工中（见 v1.2.6） |
| 链接健康检查的真实网络判定 | `LINK_CHECK_ENABLED=0` 下只验「保存即写入 `unknown`」与手动重检端点形状，不验外部站点可达性 |
| 前台 UI 行为 | 那是 `vitest` 组件测试与人工冒烟的范围，本套件只打 HTTP |

## 两个 CI job 的边界

- **compose job**：验容器编排与反代（起 `docker compose`、走反向代理访问、抓日志、`down -v`）。
- **contract job**：验协议同构（独立 SQLite + `migrate deploy` + 起后端 + `npm run contract -- --source both`）。
- 两者**互不替代**：container 起不来时 contract 仍可独立证明协议本身；反过来也一样。
