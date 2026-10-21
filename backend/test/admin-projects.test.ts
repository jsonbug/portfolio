// 后台项目接口：默认值、slug 唯一、状态机、progress 独立、技术栈/元数据整体替换、软删除
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { auth, createProject, getToken, wipeDb } from "./helpers.js";

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = buildApp();
  token = await getToken(app);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await wipeDb();
});

const patch = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/v1/admin/projects/${id}`, headers: auth(token), payload });

const get = (id: string) =>
  app.inject({ method: "GET", url: `/api/v1/admin/projects/${id}`, headers: auth(token) });

describe("POST /api/v1/admin/projects", () => {
  it("默认 draft + ongoing，published_at 为空；公开不可见", async () => {
    const created = await createProject(app, token, { name: "新项目", slug: "new-project" });
    expect(created.publish_status).toBe("draft");
    expect(created.progress).toBe("ongoing");
    expect(created.published_at).toBeNull();
    expect(created.deleted_at).toBeNull();
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("直接以 published 创建时写入 published_at", async () => {
    const created = await createProject(app, token, { name: "直接发布", publish_status: "published" });
    expect(created.publish_status).toBe("published");
    expect(typeof created.published_at).toBe("string");
  });

  it("slug 冲突 → 409 CONFLICT（details 指到 slug 字段）", async () => {
    await createProject(app, token, { name: "占位", slug: "taken-slug" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/projects",
      headers: auth(token),
      payload: { name: "撞车", slug: "taken-slug" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; details: Array<{ field: string }> } };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details[0].field).toBe("slug");
  });

  it("slug 格式非法 / summary 超 60 字 / 年份非法 → 400 VALIDATION_ERROR", async () => {
    const badSlug = await app.inject({
      method: "POST",
      url: "/api/v1/admin/projects",
      headers: auth(token),
      payload: { name: "x", slug: "Bad_Slug" },
    });
    expect(badSlug.statusCode).toBe(400);
    expect(badSlug.json().error.code).toBe("VALIDATION_ERROR");

    const longSummary = await app.inject({
      method: "POST",
      url: "/api/v1/admin/projects",
      headers: auth(token),
      payload: { name: "x", slug: "ok-slug", summary: "字".repeat(61) },
    });
    expect(longSummary.statusCode).toBe(400);

    const badYear = await app.inject({
      method: "POST",
      url: "/api/v1/admin/projects",
      headers: auth(token),
      payload: { name: "x", slug: "ok-slug-2", start_year: 20 },
    });
    expect(badYear.statusCode).toBe(400);
  });

  it("tech_stack 去重并保持顺序写入", async () => {
    const created = await createProject(app, token, {
      name: "技术栈",
      tech_stack: ["Vue", "Node.js", "Vue", "Prisma"],
    });
    expect(created.tech_stack).toEqual(["Vue", "Node.js", "Prisma"]);
  });
});

describe("PATCH /api/v1/admin/projects/:id", () => {
  it("状态机：draft→published 合法；draft→archived 非法（400 INVALID_STATUS_TRANSITION）", async () => {
    const project = await createProject(app, token, { name: "状态机" });

    const illegal = await patch(project.id, { publish_status: "archived" });
    expect(illegal.statusCode).toBe(400);
    expect(illegal.json().error.code).toBe("INVALID_STATUS_TRANSITION");

    const published = await patch(project.id, { publish_status: "published" });
    expect(published.statusCode).toBe(200);
    expect(published.json().published_at).not.toBeNull();

    // v1.2 允许撤回：published → draft
    const withdrawn = await patch(project.id, { publish_status: "draft" });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().publish_status).toBe("draft");

    // archived → published 合法
    await patch(project.id, { publish_status: "published" });
    const archived = await patch(project.id, { publish_status: "archived" });
    expect(archived.statusCode).toBe(200);
    const republished = await patch(project.id, { publish_status: "published" });
    expect(republished.statusCode).toBe(200);
  });

  it("相同状态重复提交是 no-op（不报状态机错误）", async () => {
    const project = await createProject(app, token, { name: "幂等", publish_status: "published" });
    const res = await patch(project.id, { publish_status: "published" });
    expect(res.statusCode).toBe(200);
  });

  it("progress 独立于 publish_status：草稿也能设 launched", async () => {
    const project = await createProject(app, token, { name: "进展" });
    const res = await patch(project.id, { progress: "launched" });
    expect(res.statusCode).toBe(200);
    expect(res.json().progress).toBe("launched");
    expect(res.json().publish_status).toBe("draft");
  });

  it("从未发布过的草稿改名：不写 slug 别名", async () => {
    const project = await createProject(app, token, { name: "草稿改名", slug: "draft-old" });
    const res = await patch(project.id, { slug: "draft-new" });
    expect(res.statusCode).toBe(200);

    const aliases = await prisma.slugAlias.findMany({ where: { entity_type: "project" } });
    expect(aliases).toHaveLength(0);
  });

  it("发布过的项目改名：写入别名，旧 slug 走 301", async () => {
    const project = await createProject(app, token, { name: "发布改名", slug: "pub-old", publish_status: "published" });
    await patch(project.id, { slug: "pub-new" });

    const alias = await prisma.slugAlias.findFirst({
      where: { entity_type: "project", slug: "pub-old" },
    });
    expect(alias?.entity_id).toBe(project.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/projects/pub-old" });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe("/api/v1/projects/pub-new");
  });

  it("改名为已被占用的 slug → 409，且原名不变", async () => {
    await createProject(app, token, { name: "已占用", slug: "occupied" });
    const project = await createProject(app, token, { name: "想改名", slug: "want-rename" });

    const res = await patch(project.id, { slug: "occupied" });
    expect(res.statusCode).toBe(409);

    const after = await get(project.id);
    expect(after.json().slug).toBe("want-rename");
  });

  it("显式 null 清空 nullable 字段", async () => {
    const project = await createProject(app, token, {
      name: "清空",
      role: "全栈",
      start_year: 2020,
      cover_image_url: "https://e.com/a.png",
    });
    const res = await patch(project.id, { role: null, start_year: null, cover_image_url: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBeNull();
    expect(res.json().start_year).toBeNull();
    expect(res.json().cover_image_url).toBeNull();
  });

  it("tech_stack 传数组即整体替换（[] 清空）", async () => {
    const project = await createProject(app, token, { name: "替换", tech_stack: ["Vue", "Node.js"] });
    const replaced = await patch(project.id, { tech_stack: ["Fastify"] });
    expect(replaced.json().tech_stack).toEqual(["Fastify"]);

    const cleared = await patch(project.id, { tech_stack: [] });
    expect(cleared.json().tech_stack).toEqual([]);
  });

  it("不存在的项目 → 404", async () => {
    const res = await patch("no-such-id", { name: "x" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("PUT /api/v1/admin/projects/:id/metadata", () => {
  const put = (id: string, payload: unknown) =>
    app.inject({ method: "PUT", url: `/api/v1/admin/projects/${id}/metadata`, headers: auth(token), payload });

  it("整体替换：第二次提交覆盖第一次，顺序按 sort", async () => {
    const project = await createProject(app, token, { name: "元数据" });
    const first = await put(project.id, [{ key_label: "A", value: "1" }]);
    expect(first.json().metadata).toEqual([{ key_label: "A", value: "1", kind: "meta", sort: 0 }]);

    const second = await put(project.id, [
      { key_label: "B", value: "2", sort: 1 },
      { key_label: "C", value: "3", sort: 0 },
    ]);
    const labels = (second.json().metadata as Array<{ key_label: string }>).map((m) => m.key_label);
    expect(labels).toEqual(["C", "B"]);
  });

  it("键名重复 → 400（不落到数据库 409）", async () => {
    const project = await createProject(app, token, { name: "重复键" });
    const res = await put(project.id, [
      { key_label: "重复", value: "1" },
      { key_label: "重复", value: "2" },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("空数组清空全部元数据", async () => {
    const project = await createProject(app, token, { name: "清空元数据" });
    await put(project.id, [{ key_label: "A", value: "1" }]);
    const res = await put(project.id, []);
    expect(res.json().metadata).toEqual([]);
  });
});

describe("DELETE /api/v1/admin/projects/:id 与 restore", () => {
  it("软删除：前台不可见、后台默认列表隐藏，includeDeleted 可见", async () => {
    const project = await createProject(app, token, { name: "待删除", publish_status: "published" });
    const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${project.id}`, headers: auth(token) });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted_at).toMatch(/^\d{4}-/);

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/projects/${project.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    const hidden = await app.inject({ method: "GET", url: "/api/v1/admin/projects", headers: auth(token) });
    expect(hidden.json().items).toHaveLength(0);

    const shown = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?includeDeleted=true",
      headers: auth(token),
    });
    expect(shown.json().items).toHaveLength(1);
  });

  it("重复删除幂等（deleted_at 不变）", async () => {
    const project = await createProject(app, token, { name: "幂等删除" });
    const first = await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${project.id}`, headers: auth(token) });
    const second = await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${project.id}`, headers: auth(token) });
    expect(second.statusCode).toBe(200);
    expect(second.json().deleted_at).toBe(first.json().deleted_at);
  });

  it("restore 恢复后前台重新可见", async () => {
    const project = await createProject(app, token, { name: "恢复", publish_status: "published" });
    await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${project.id}`, headers: auth(token) });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${project.id}/restore`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted_at).toBeNull();

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/projects/${project.slug}` });
    expect(publicDetail.statusCode).toBe(200);
  });

  it("删除不存在的项目 → 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/v1/admin/projects/nope", headers: auth(token) });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/admin/projects（后台列表）", () => {
  it("默认包含 draft/archived，可按 publish_status / progress / search 过滤", async () => {
    await createProject(app, token, { name: "草稿清单" });
    await createProject(app, token, { name: "发布清单", publish_status: "published", progress: "launched" });
    await createProject(app, token, { name: "归档清单", publish_status: "archived" });

    const all = await app.inject({ method: "GET", url: "/api/v1/admin/projects", headers: auth(token) });
    expect(all.json().total).toBe(3);

    const published = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?publish_status=published",
      headers: auth(token),
    });
    expect(published.json().items.map((i: { name: string }) => i.name)).toEqual(["发布清单"]);

    const launched = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?progress=launched",
      headers: auth(token),
    });
    expect(launched.json().total).toBe(1);

    const searched = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?search=归档",
      headers: auth(token),
    });
    expect(searched.json().items.map((i: { name: string }) => i.name)).toEqual(["归档清单"]);
  });

  it("search 按字面量匹配：% 与 _ 不当通配符（转义走 LIKE ? ESCAPE）", async () => {
    await createProject(app, token, { name: "完成度 100% 的项目" });
    await createProject(app, token, { name: "a_b 命名约定" });
    await createProject(app, token, { name: "普通项目" });

    const percent = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects?search=${encodeURIComponent("%")}`,
      headers: auth(token),
    });
    // 不转义的话 `%` 是「匹配任意」：三个项目全命中
    expect(percent.json().total).toBe(1);
    expect(percent.json().items.map((i: { name: string }) => i.name)).toEqual(["完成度 100% 的项目"]);

    const underscore = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects?search=${encodeURIComponent("a_b")}`,
      headers: auth(token),
    });
    expect(underscore.json().total).toBe(1);
    expect(underscore.json().items.map((i: { name: string }) => i.name)).toEqual(["a_b 命名约定"]);

    // 计数口径与列表同源：分段计数也是转义后的集合（all = draft + published + archived）
    const counts = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects?search=${encodeURIComponent("%")}&publish_status=draft`,
      headers: auth(token),
    });
    expect(counts.json().counts.all).toBe(1);
    expect(counts.json().total).toBe(1);
  });

  it("后台列表项带 publish_status / published_at / deleted_at", async () => {
    await createProject(app, token, { name: "后台字段", publish_status: "published" });
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/projects", headers: auth(token) });
    const item = (res.json().items as Array<Record<string, unknown>>)[0];
    expect(item.publish_status).toBe("published");
    expect(item.published_at).not.toBeNull();
    expect(item.deleted_at).toBeNull();
  });

  it("counts 四段口径：全部 / 已发布 / 草稿 / 已归档（含软删除时同口径）", async () => {
    await createProject(app, token, { name: "草稿 A" });
    await createProject(app, token, { name: "草稿 B" });
    await createProject(app, token, { name: "已发布 A", publish_status: "published" });
    const archived = await createProject(app, token, { name: "已归档 A", publish_status: "archived" });
    const removed = await createProject(app, token, { name: "已删除", publish_status: "published" });
    await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/projects/${removed.id}`,
      headers: auth(token),
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/projects", headers: auth(token) });
    const body = res.json() as { counts: Record<string, number>; total: number };
    // 软删除项目默认不计入；all = draft + published + archived
    expect(body.counts).toEqual({ all: 4, draft: 2, published: 1, archived: 1 });
    expect(body.total).toBe(4);

    // 分段过滤不改 counts（分段数字始终显示全部口径）
    const onlyDraft = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?publish_status=draft",
      headers: auth(token),
    });
    expect((onlyDraft.json() as { counts: Record<string, number> }).counts).toEqual(body.counts);
    expect((onlyDraft.json() as { total: number }).total).toBe(2);

    // 搜索后 counts 按搜索结果重算；includeDeleted 把软删除计回
    const searched = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?search=已归档",
      headers: auth(token),
    });
    expect((searched.json() as { counts: Record<string, number> }).counts.all).toBe(1);
    expect(archived.publish_status).toBe("archived");

    const withDeleted = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?includeDeleted=true",
      headers: auth(token),
    });
    expect((withDeleted.json() as { counts: Record<string, number> }).counts).toEqual({
      all: 5,
      draft: 2,
      published: 2,
      archived: 1,
    });
  });

  it("未带 Bearer → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/projects" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/admin/projects/:id", () => {
  it("详情含全部笔记（含草稿）与 cover_source_url", async () => {
    const project = await createProject(app, token, { name: "后台详情" });
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/notes",
      headers: auth(token),
      payload: { project_id: project.id, slug: "n-draft", title: "草稿笔记", body_md: "x" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/notes",
      headers: auth(token),
      payload: { project_id: project.id, slug: "n-pub", title: "发布笔记", body_md: "x", publish_status: "published" },
    });

    const res = await get(project.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      notes: Array<{ title: string; publish_status: string }>;
      cover_source_url: string | null;
    };
    expect(body.notes).toHaveLength(2);
    // 编辑器要在项目内区分草稿/已发布（笔记 N:1 后同一项目多篇笔记）
    expect(body.notes.map((n) => [n.title, n.publish_status])).toEqual(
      expect.arrayContaining([
        ["草稿笔记", "draft"],
        ["发布笔记", "published"],
      ]),
    );
    expect(body.cover_source_url).toBeNull();
  });

  it("不存在 → 404", async () => {
    const res = await get("nope");
    expect(res.statusCode).toBe(404);
  });
});
