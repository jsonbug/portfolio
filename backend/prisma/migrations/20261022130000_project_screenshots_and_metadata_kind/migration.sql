-- 项目截图（F2 截图轮播）+ 元数据 kind（F2 指标卡）
--
-- 新增内容（纯加法，向后兼容，不动已合入的 v1.2 数据模型迁移）：
--   1) 新表 project_screenshots：id / project_id(FK, cascade) / url / caption(可空) / sort
--   2) project_metadata 加列 kind（'meta' | 'metric'，默认 'meta'）
--      既有 KV 全部按 meta 渲染 → 零回填（ALTER TABLE ... DEFAULT 自动填充旧行）
--   3) 约束（≤10 张截图、caption ≤80、metric ≤2 条且键值长度）在应用层校验，
--      不进 SQL：SQLite 没有 CHECK 的在线演进能力，写在库里日后改动要重建表。
--
-- 回滚步骤（手工，执行前先备份 db 文件）：
--   1) cp data/prod.db data/prod.db.bak-$(date +%Y%m%d%H%M%S)
--   2) 回滚代码到不含本迁移的提交
--   3) 删表删列（SQLite 3.35+ 支持 DROP COLUMN）：
--        DROP TABLE IF EXISTS "project_screenshots";
--        ALTER TABLE "project_metadata" DROP COLUMN "kind";
--   4) 删掉本迁移目录，并执行 prisma migrate resolve --rolled-back 20261022130000_project_screenshots_and_metadata_kind
--
-- 迁移失败后的恢复步骤（演练见 backend/test/migration-recovery.test.ts）：
--   1) 恢复备份：cp data/prod.db.bak-<时间戳> data/prod.db（并删掉 -wal / -shm）
--   2) 让 Prisma 忘掉这次失败的记录：
--        npx prisma migrate resolve --rolled-back 20261022130000_project_screenshots_and_metadata_kind
--   3) 确认状态回到 "not applied"：npx prisma migrate status
--   4) 修正导致失败的原因（磁盘满 / 权限 / 手工改过表结构）后重跑：npx prisma migrate deploy
--   5) 若第 2 步之前已部分执行（本迁移第二句失败），第 1 步的备份恢复是唯一可靠手段——
--      不要手工补列再 resolve，那会让 _prisma_migrations 与实际结构不一致。
--   注意：ALTER TABLE ADD COLUMN 失败不会留下半列（SQLite 原子），所以第二句失败时库仍是迁移前状态。

-- 1) 元数据加 kind（旧行自动填 'meta'）
ALTER TABLE "project_metadata" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'meta';

-- 2) 截图表
CREATE TABLE "project_screenshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_screenshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "project_screenshots_project_id_idx" ON "project_screenshots"("project_id");
