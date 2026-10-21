-- project_screenshots 的 project_id 索引（从 20261022130100 拆出，见该文件头注释）
--
-- 一条语句一个文件：建索引失败时只有本文件失败，`resolve --rolled-back` 后重跑不会
-- 撞上「表已存在」——那是把非原子窗口又主动开一次。
--
-- `IF NOT EXISTS` 是给**已经跑过旧版 20261022130100 的库**（索引已随建表创建）留的退路：
-- 那些库重跑到本文件时是 no-op，而不是 `index already exists`。新库则由本文件创建索引。
--
-- 回滚（执行前先备份 db 文件）：
--   DROP INDEX IF EXISTS "project_screenshots_project_id_idx";
--   npx prisma migrate resolve --rolled-back 20261022130200_project_screenshots_index

CREATE INDEX IF NOT EXISTS "project_screenshots_project_id_idx" ON "project_screenshots"("project_id");
