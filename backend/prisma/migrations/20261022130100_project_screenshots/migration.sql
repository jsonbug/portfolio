-- 新表 project_screenshots（F2 截图轮播）
--
-- 新增内容（纯加法，向后兼容）：id / project_id(FK, cascade) / url / caption(可空) / sort。
-- 只存原图 URL，派生尺寸交前端 object-fit（后端不做第二套图片管线）。
-- 上限（≤10 张、caption ≤80 字、url 必须 http(s)）在应用层校验，不进 SQL：
-- SQLite 没有可在线演进的 CHECK 约束，写在库里日后改动要重建表。
--
-- 回滚（执行前先备份 db 文件）：
--   cp data/prod.db data/prod.db.bak-$(date +%Y%m%d%H%M%S)
--   DROP TABLE IF EXISTS "project_screenshots";
--   npx prisma migrate resolve --rolled-back 20261022130100_project_screenshots
--
-- 迁移失败后的恢复：同 20261022130000 的头注释（备份 → resolve --rolled-back → status → 修因重跑）。
-- 本文件两条语句（建表 + 建索引）：若建索引失败，表已存在，resolve 后重跑会报 table already exists，
-- 此时删表（或恢复备份）再重跑即可。

CREATE TABLE "project_screenshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_screenshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "project_screenshots_project_id_idx" ON "project_screenshots"("project_id");
