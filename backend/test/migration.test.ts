// v1.2 迁移脚本自身的行为测试：把 v1.0 结构 + 数据搬进新表，且数据不丢
// 用独立数据库文件（prisma/migration-test.db）+ 直接执行迁移 SQL，不依赖 Prisma schema 的当前状态。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(backendDir, "prisma", "migration-test.db");
const migrationsDir = resolve(backendDir, "prisma", "migrations");

const INIT_SQL = resolve(migrationsDir, "20261021113258_init", "migration.sql");
const COVER_SQL = resolve(migrationsDir, "20261021121009_add_cover_image", "migration.sql");
const V12_SQL = resolve(migrationsDir, "20261021230000_v1_2_data_model", "migration.sql");

let db: PrismaClient;

// 迁移文件里没有字符串字面量含分号，按 ';' 切分 + 去注释行即可
function statements(sqlPath: string): string[] {
  return readFileSync(sqlPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(sqlPath: string): Promise<void> {
  for (const stmt of statements(sqlPath)) {
    await db.$executeRawUnsafe(stmt);
  }
}

const MS = (iso: string) => Date.parse(iso);

beforeAll(async () => {
  rmSync(dbPath, { force: true });
  db = new PrismaClient({ datasourceUrl: `file:${dbPath}` });

  // 1. 回到 v1.0 结构
  await apply(INIT_SQL);
  await apply(COVER_SQL);

  // 2. 写入 v1.0 形态的历史数据（Prisma 把 DATETIME 存为 unix 毫秒整数）
  const createdAt = MS("2023-05-01T10:00:00.000Z");
  const updatedAt = MS("2024-06-01T10:00:00.000Z");

  await db.$executeRawUnsafe(
    `INSERT INTO "project" ("id","name","tagline","description","status","stars","lastActivityAt","role","projectStatus","startDate","githubRepo","deletedAt","createdAt","updatedAt")
     VALUES ('p_pub','已上线项目',?,?, 'published', 42, ?, '全栈', 'completed', ?, 'https://github.com/a/b', NULL, ?, ?)`,
    "一句话简介".repeat(20),
    "# 正文",
    updatedAt,
    MS("2022-03-15T00:00:00.000Z"),
    createdAt,
    updatedAt,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "project" ("id","name","status","projectStatus","deletedAt","createdAt","updatedAt")
     VALUES ('p_draft','草稿项目','draft','building', NULL, ?, ?)`,
    createdAt,
    updatedAt,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "project" ("id","name","status","deletedAt","createdAt","updatedAt")
     VALUES ('p_del','已删项目','published', ?, ?, ?)`,
    updatedAt,
    createdAt,
    updatedAt,
  );

  await db.$executeRawUnsafe(`INSERT INTO "technology" ("id","name") VALUES ('t1','Vue'),('t2','Node.js')`);
  await db.$executeRawUnsafe(
    `INSERT INTO "project_technology" ("projectId","technologyId") VALUES ('p_pub','t1'),('p_pub','t2')`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "link" ("id","projectId","type","label","url","sortOrder","createdAt")
     VALUES ('l1','p_pub','website','官网','https://e.com',0,?)`,
    createdAt,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "note" ("id","projectId","title","content","createdAt","updatedAt")
     VALUES ('n1','p_pub','旧笔记','旧正文',?,?)`,
    createdAt,
    updatedAt,
  );

  // 3. 执行被测迁移
  await apply(V12_SQL);
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dbPath, { force: true });
});

type ProjectRow = {
  id: string;
  slug: string;
  summary: string | null;
  publish_status: string;
  progress: string;
  start_year: number | null;
  published_at: Date | null;
  deleted_at: Date | null;
  cover_image_url: string | null;
  description_md: string | null;
};

describe("v1.2 迁移：结构", () => {
  it("旧表被移除，新表全部建立", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const names = rows.map((r) => r.name);
    for (const old of ["project", "technology", "project_technology", "link", "note"]) {
      expect(names).not.toContain(old);
    }
    for (const created of [
      "projects",
      "project_tech_stack",
      "project_links",
      "project_metadata",
      "notes",
      "note_tags",
      "slug_aliases",
      "admin_users",
    ]) {
      expect(names).toContain(created);
    }
  });

  it("slug 唯一键存在", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('projects','notes','slug_aliases')`,
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain("projects_slug_key");
    expect(names).toContain("notes_slug_key");
    expect(names).toContain("slug_aliases_entity_type_slug_key");
  });
});

describe("v1.2 迁移：数据搬运", () => {
  it("项目：行数不丢，slug 生成合法占位值，字段按口径映射", async () => {
    const rows = await db.$queryRawUnsafe<ProjectRow[]>(
      `SELECT "id","slug","summary","publish_status","progress","start_year","published_at","deleted_at","cover_image_url","description_md" FROM "projects" ORDER BY "id"`,
    );
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.slug).toMatch(/^project-[0-9a-f]{16}$/);
    }

    const pub = rows.find((r) => r.id === "p_pub")!;
    expect(pub.publish_status).toBe("published");
    expect(pub.progress).toBe("launched"); // projectStatus=completed
    expect(pub.start_year).toBe(2022);
    expect(pub.description_md).toBe("# 正文");
    expect(pub.summary).toHaveLength(60); // tagline 截断到 60 字
    expect(pub.published_at?.getTime()).toBe(MS("2024-06-01T10:00:00.000Z"));

    const draft = rows.find((r) => r.id === "p_draft")!;
    expect(draft.progress).toBe("ongoing"); // projectStatus=building
    expect(draft.publish_status).toBe("draft");
    expect(draft.published_at).toBeNull();
    expect(draft.start_year).toBeNull();

    const del = rows.find((r) => r.id === "p_del")!;
    expect(del.deleted_at?.getTime()).toBe(MS("2024-06-01T10:00:00.000Z"));
    expect(del.published_at).toBeNull(); // 已软删除 → 不补 published_at
  });

  it("技术栈：从 technology + project_technology 搬入 project_tech_stack，sort 从 0 起", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ name: string; sort: number }>>(
      `SELECT "name","sort" FROM "project_tech_stack" WHERE "project_id"='p_pub' ORDER BY "sort"`,
    );
    expect(rows.map((r) => r.name)).toEqual(["Node.js", "Vue"]);
    expect(rows.map((r) => r.sort)).toEqual([0, 1]);
  });

  it("链接：website → site，其余字段与 createdAt 保留", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; type: string; label: string; sort: number; created_at: Date }>>(
      `SELECT "id","type","label","sort","created_at" FROM "project_links"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "l1", type: "site", label: "官网", sort: 0 });
    expect(rows[0].created_at.getTime()).toBe(MS("2023-05-01T10:00:00.000Z"));
  });

  it("笔记：content → body_md，补 slug 与 published/published_at", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; slug: string; body_md: string; publish_status: string; published_at: Date }>>(
      `SELECT "id","slug","body_md","publish_status","published_at" FROM "notes"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("n1");
    expect(rows[0].slug).toMatch(/^note-[0-9a-f]{16}$/);
    expect(rows[0].body_md).toBe("旧正文");
    expect(rows[0].publish_status).toBe("published");
    expect(rows[0].published_at.getTime()).toBe(MS("2023-05-01T10:00:00.000Z"));
  });

  it("project_metadata / note_tags / slug_aliases / admin_users 迁移后为空表", async () => {
    for (const table of ["project_metadata", "note_tags", "slug_aliases", "admin_users"]) {
      const rows = await db.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT COUNT(*) AS c FROM "${table}"`);
      expect(Number(rows[0].c)).toBe(0);
    }
  });
});
