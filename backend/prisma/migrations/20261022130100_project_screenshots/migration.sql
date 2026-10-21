-- 新表 project_screenshots（F2 截图轮播）——**只建表，索引在 20261022130200**
--
-- 新增内容（纯加法，向后兼容）：id / project_id(FK, cascade) / url / caption(可空) / sort。
-- 只存原图 URL，派生尺寸交前端 object-fit（后端不做第二套图片管线）。
-- 上限（≤10 张、caption ≤80 字、url 必须是能解析的 http(s) 绝对地址）在应用层校验，不进 SQL：
-- SQLite 没有可在线演进的 CHECK 约束，写在库里日后改动要重建表。
--
-- 一个文件只放**一条语句**：SQLite 下迁移文件不是原子执行，建表成功、建索引失败会留下
-- 「表在、索引不在」的半迁移状态，而 `migrate resolve --rolled-back` 之后重跑会报
-- `table already exists`（这一点用真库演练过，见 docs/deployment.md §4）。
-- 同批第二条语句（CREATE INDEX）因此拆到 20261022130200。
--
-- 回滚（执行前先备份 db 文件）：
--   cp data/prod.db data/prod.db.bak-$(date +%Y%m%d%H%M%S)
--   DROP TABLE IF EXISTS "project_screenshots";   -- 索引随之消失
--   npx prisma migrate resolve --rolled-back 20261022130100_project_screenshots
--   npx prisma migrate resolve --rolled-back 20261022130200_project_screenshots  # 若也已记录
--
-- 迁移失败后的恢复：同 20261022130000 的头注释（恢复备份 → resolve --rolled-back → status → 修因重跑）。

CREATE TABLE "project_screenshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_screenshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
