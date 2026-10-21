-- v1.2 数据层迁移（《开发计划 v1.2》第五节）
--
-- 目标结构：projects / project_tech_stack / project_links / project_metadata /
--           notes / note_tags / slug_aliases / admin_users
-- 旧结构（v1.0）：project / technology / project_technology / link / note
--
-- 本迁移**保留已有数据**（新建表 → INSERT SELECT 搬运 → 删除旧表），不物理丢数据；
-- 旧数据缺少的 v1.2 必填值按保守口径补齐并在下方逐处注明：
--   - projects.slug：旧数据无 slug → 生成 `project-<16位hex>` 占位（符合 ^[a-z0-9-]{2,64}$），后台可改；
--   - projects.progress：旧 projectStatus ∈ {completed, maintained} 视为 launched，其余 ongoing；
--   - notes.slug：旧数据无 slug → 生成 `note-<16位hex>` 占位；
--   - notes.publish_status：旧笔记原本随项目公开 → published，published_at 取 createdAt；
--   - link.type 的 website → site（v1.2 枚举改名）。
--
-- 回滚：Prisma migrate 无 down 迁移；本迁移为前向数据搬运，回滚请用迁移前的数据库备份
--      （`cp prisma/dev.db prisma/dev.db.bak`）恢复。

-- ---------- 1. projects ----------
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "description_md" TEXT,
    "cover_image_url" TEXT,
    "cover_source_url" TEXT,
    "publish_status" TEXT NOT NULL DEFAULT 'draft',
    "progress" TEXT NOT NULL DEFAULT 'ongoing',
    "stars" INTEGER,
    "version" TEXT,
    "last_updated_at" DATETIME,
    "role" TEXT,
    "license" TEXT,
    "start_year" INTEGER,
    "team_size" INTEGER,
    "published_at" DATETIME,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

INSERT INTO "projects" (
    "id", "slug", "name", "summary", "description_md",
    "cover_image_url", "cover_source_url", "publish_status", "progress",
    "stars", "version", "last_updated_at", "role", "license", "start_year", "team_size",
    "published_at", "deleted_at", "created_at", "updated_at"
)
SELECT
    "id",
    'project-' || lower(hex(randomblob(8))),
    "name",
    CASE WHEN "tagline" IS NULL THEN NULL ELSE substr("tagline", 1, 60) END,
    "description",
    "coverImage",
    NULL,
    "status",
    CASE WHEN "projectStatus" IN ('completed', 'maintained') THEN 'launched' ELSE 'ongoing' END,
    "stars",
    NULL,
    "lastActivityAt",
    "role",
    NULL,
    CASE WHEN "startDate" IS NULL THEN NULL
         ELSE CAST(strftime('%Y', "startDate" / 1000, 'unixepoch') AS INTEGER) END,
    NULL,
    CASE WHEN "status" = 'published' AND "deletedAt" IS NULL THEN "updatedAt" ELSE NULL END,
    "deletedAt",
    "createdAt",
    "updatedAt"
FROM "project";

CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");
CREATE INDEX "projects_publish_status_deleted_at_idx" ON "projects"("publish_status", "deleted_at");
CREATE INDEX "projects_name_idx" ON "projects"("name");

-- ---------- 2. project_tech_stack ----------
CREATE TABLE "project_tech_stack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_tech_stack_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "project_tech_stack" ("id", "project_id", "name", "sort")
SELECT
    lower(hex(randomblob(16))),
    pt."projectId",
    t."name",
    (SELECT COUNT(*)
       FROM "project_technology" pt2
       JOIN "technology" t2 ON t2."id" = pt2."technologyId"
      WHERE pt2."projectId" = pt."projectId" AND t2."name" < t."name")
FROM "project_technology" pt
JOIN "technology" t ON t."id" = pt."technologyId";

CREATE UNIQUE INDEX "project_tech_stack_project_id_name_key" ON "project_tech_stack"("project_id", "name");
CREATE INDEX "project_tech_stack_name_idx" ON "project_tech_stack"("name");

-- ---------- 3. project_links ----------
CREATE TABLE "project_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "url" TEXT NOT NULL,
    "label" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "last_status" TEXT,
    "last_http_status" INTEGER,
    "last_checked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "project_links" ("id", "project_id", "type", "url", "label", "sort", "created_at")
SELECT
    "id",
    "projectId",
    CASE "type" WHEN 'website' THEN 'site' ELSE "type" END,
    "url",
    "label",
    "sortOrder",
    "createdAt"
FROM "link";

CREATE INDEX "project_links_project_id_idx" ON "project_links"("project_id");

-- ---------- 4. project_metadata ----------
CREATE TABLE "project_metadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "key_label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_metadata_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_metadata_project_id_key_label_key" ON "project_metadata"("project_id", "key_label");

-- ---------- 5. notes ----------
CREATE TABLE "notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "publish_status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "notes" ("id", "project_id", "slug", "title", "body_md", "publish_status", "published_at", "created_at", "updated_at")
SELECT
    "id",
    "projectId",
    'note-' || lower(hex(randomblob(8))),
    "title",
    "content",
    'published',
    "createdAt",
    "createdAt",
    "updatedAt"
FROM "note";

CREATE UNIQUE INDEX "notes_slug_key" ON "notes"("slug");
CREATE INDEX "notes_project_id_idx" ON "notes"("project_id");
CREATE INDEX "notes_publish_status_idx" ON "notes"("publish_status");

-- ---------- 6. note_tags ----------
CREATE TABLE "note_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "note_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "note_tags_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "note_tags_note_id_name_key" ON "note_tags"("note_id", "name");

-- ---------- 7. slug_aliases ----------
CREATE TABLE "slug_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "slug_aliases_entity_type_slug_key" ON "slug_aliases"("entity_type", "slug");
CREATE INDEX "slug_aliases_entity_type_entity_id_idx" ON "slug_aliases"("entity_type", "entity_id");

-- ---------- 8. admin_users ----------
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- ---------- 9. 移除旧表（数据已搬运） ----------
DROP TABLE "project_technology";
DROP TABLE "note";
DROP TABLE "link";
DROP TABLE "technology";
DROP TABLE "project";
