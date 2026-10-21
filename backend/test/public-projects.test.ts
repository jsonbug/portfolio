// 前台公开接口（无鉴权）：可见性、分段、筛选、slug 301、详情拼装
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { auth, createNote, createProject, getToken, wipeDb } from "./helpers.js";

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

const list = async (query = "") => {
  const res = await app.inject({ method: "GET", url: `/api/v1/projects${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    items: Array<Record<string, unknown> & { name: string; tech_stack: string[] }>;
    total: number;
    totalPages: number;
    counts: { all: number; ongoing: number; launched: number };
  };
};

describe("GET /api/v1/projects（前台列表）", () => {
  it("只返回 published 且未软删除；draft/archived/已删除不可见", async () => {
    await createProject(app, token, { name: "草稿项目" });
    await createProject(app, token, { name: "已发布项目", publish_status: "published" });
    await createProject(app, token, { name: "归档项目", publish_status: "archived" });
    const del = await createProject(app, token, { name: "已删已发布", publish_status: "published" });
    await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${del.id}`, headers: auth(token) });

    const body = await list();
    const names = body.items.map((i) => i.name);
    expect(names).toEqual(["已发布项目"]);
  });

  it("响应不含 publish_status / deleted_at 等后台字段", async () => {
    await createProject(app, token, { name: "公开项目", publish_status: "published" });
    const body = await list();
    const item = body.items[0];
    expect("publish_status" in item).toBe(false);
    expect("deleted_at" in item).toBe(false);
    expect("published_at" in item).toBe(false);
    expect(item.progress).toBe("ongoing");
  });

  it("counts 三段口径：归档既不展示也不参与分段统计", async () => {
    await createProject(app, token, { name: "A", publish_status: "published", progress: "ongoing" });
    await createProject(app, token, { name: "B", publish_status: "published", progress: "launched" });
    await createProject(app, token, { name: "C", publish_status: "archived", progress: "launched" });
    await createProject(app, token, { name: "D" });

    const body = await list();
    expect(body.counts).toEqual({ all: 2, ongoing: 1, launched: 1 });
  });

  it("progress 分段过滤：仅 ongoing / launched 两个值", async () => {
    await createProject(app, token, { name: "进行中1", publish_status: "published", progress: "ongoing" });
    await createProject(app, token, { name: "已上线1", publish_status: "published", progress: "launched" });

    const ongoing = await list("?progress=ongoing");
    expect(ongoing.items.map((i) => i.name)).toEqual(["进行中1"]);

    const launched = await list("?progress=launched");
    expect(launched.items.map((i) => i.name)).toEqual(["已上线1"]);
    // 分段过滤不影响 counts 口径（仍是全部可见项目的统计）
    expect(launched.counts).toEqual({ all: 2, ongoing: 1, launched: 1 });

    const invalid = await app.inject({ method: "GET", url: "/api/v1/projects?progress=archived" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("search 匹配名称与摘要", async () => {
    await createProject(app, token, { name: "Alpha 平台", publish_status: "published" });
    await createProject(app, token, { name: "无关项目", summary: "包含 Beta 关键词", publish_status: "published" });

    expect((await list("?search=Alpha")).items.map((i) => i.name)).toEqual(["Alpha 平台"]);
    expect((await list("?search=Beta")).items.map((i) => i.name)).toEqual(["无关项目"]);
  });

  it("technology 多选：逗号分隔与重复参数都按「任一命中」过滤", async () => {
    await createProject(app, token, { name: "Vue项目", publish_status: "published", tech_stack: ["Vue", "Node.js"] });
    await createProject(app, token, { name: "React项目", publish_status: "published", tech_stack: ["React"] });
    await createProject(app, token, { name: "草稿React", tech_stack: ["React"] });

    const comma = await list("?technology=Vue,React");
    expect(comma.items.map((i) => i.name).sort()).toEqual(["React项目", "Vue项目"]);

    const repeated = await list("?technology=Vue&technology=Node.js");
    expect(repeated.items.map((i) => i.name)).toEqual(["Vue项目"]);
  });

  it("sort=recent（默认）与 sort=stars", async () => {
    await createProject(app, token, {
      name: "旧Star高",
      publish_status: "published",
      stars: 500,
      last_updated_at: "2024-01-01T00:00:00.000Z",
    });
    await createProject(app, token, {
      name: "新Star低",
      publish_status: "published",
      stars: 1,
      last_updated_at: "2025-01-01T00:00:00.000Z",
    });

    expect((await list()).items.map((i) => i.name)).toEqual(["新Star低", "旧Star高"]);
    expect((await list("?sort=stars")).items.map((i) => i.name)).toEqual(["旧Star高", "新Star低"]);
  });

  it("tech_stack 按 sort 顺序输出（不含后台 sort 字段）", async () => {
    await createProject(app, token, {
      name: "顺序项目",
      publish_status: "published",
      tech_stack: ["TypeScript", "Fastify", "Prisma"],
    });
    const item = (await list()).items[0];
    expect(item.tech_stack).toEqual(["TypeScript", "Fastify", "Prisma"]);
  });

  it("分页：page/pageSize 生效，pageSize 上限 100", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createProject(app, token, { name: `项目${i}`, publish_status: "published" });
    }
    const body = await list("?page=1&pageSize=2");
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.totalPages).toBe(2);

    const tooBig = await app.inject({ method: "GET", url: "/api/v1/projects?pageSize=101" });
    expect(tooBig.statusCode).toBe(400);
  });
});

describe("GET /api/v1/projects/:slug（前台详情）", () => {
  it("按 slug 返回固定元数据、自定义 KV、链接与已发布笔记", async () => {
    const project = await createProject(app, token, {
      name: "详情项目",
      publish_status: "published",
      progress: "launched",
      summary: "一句话摘要",
      description_md: "# 正文",
      role: "全栈",
      license: "MIT",
      start_year: 2023,
      team_size: 3,
      tech_stack: ["Vue"],
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${project.id}/metadata`,
      headers: auth(token),
      payload: [
        { key_label: "代码行数", value: "12k", sort: 1 },
        { key_label: "线上地址", value: "https://demo.example.com", sort: 0 },
      ],
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${project.id}/links`,
      headers: auth(token),
      payload: { type: "repo", url: "https://github.com/x/y", label: "GitHub" },
    });
    await createNote(app, token, { project_id: project.id, title: "已发布笔记", publish_status: "published" });
    await createNote(app, token, { project_id: project.id, title: "草稿笔记" });

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${project.slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown> & {
      notes: Array<{ title: string }>;
      metadata: Array<{ key_label: string; value: string; sort: number }>;
      links: Array<{ type: string; label: string }>;
    };

    expect(body.name).toBe("详情项目");
    expect(body.role).toBe("全栈");
    expect(body.license).toBe("MIT");
    expect(body.start_year).toBe(2023);
    expect(body.team_size).toBe(3);
    expect(body.description_md).toBe("# 正文");
    expect(body.notes.map((n) => n.title)).toEqual(["已发布笔记"]);
    expect(body.metadata.map((m) => m.key_label)).toEqual(["线上地址", "代码行数"]);
    expect(body.links[0]).toMatchObject({ type: "repo", label: "GitHub", last_status: "unknown" });
    expect("publish_status" in body).toBe(false);
    expect("cover_source_url" in body).toBe(false);
  });

  it("草稿 / 归档 / 已删除 / 不存在：统一 404，不泄露存在性", async () => {
    const draft = await createProject(app, token, { name: "草稿" });
    const archived = await createProject(app, token, { name: "归档", publish_status: "archived" });
    const deleted = await createProject(app, token, { name: "删除", publish_status: "published" });
    await app.inject({ method: "DELETE", url: `/api/v1/admin/projects/${deleted.id}`, headers: auth(token) });

    for (const slug of [draft.slug, archived.slug, deleted.slug, "not-exists"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/projects/${slug}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
  });

  it("改名后旧 slug 301 到新 slug（B15）", async () => {
    const project = await createProject(app, token, { name: "改名项目", publish_status: "published" });
    const oldSlug = project.slug;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${project.id}`,
      headers: auth(token),
      payload: { slug: "renamed-project" },
    });
    expect(patch.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${oldSlug}` });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe("/api/v1/projects/renamed-project");

    const fresh = await app.inject({ method: "GET", url: "/api/v1/projects/renamed-project" });
    expect(fresh.statusCode).toBe(200);
  });

  it("旧 slug 指向的项目已归档时不再跳转（301 只在目标可见时发生）", async () => {
    const project = await createProject(app, token, { name: "先发布再归档", publish_status: "published" });
    const oldSlug = project.slug;
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${project.id}`,
      headers: auth(token),
      payload: { slug: "archived-target", publish_status: "archived" },
    });

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${oldSlug}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/notes 与 /api/v1/notes/:slug（前台笔记）", () => {
  it("只返回已发布笔记，且所属项目必须可见", async () => {
    const pub = await createProject(app, token, { name: "公开项目", publish_status: "published" });
    const archived = await createProject(app, token, { name: "归档项目", publish_status: "archived" });
    await createNote(app, token, { project_id: pub.id, title: "可见笔记", publish_status: "published", tags: ["复盘"] });
    await createNote(app, token, { project_id: pub.id, title: "草稿笔记" });
    await createNote(app, token, { project_id: archived.id, title: "归档项目笔记", publish_status: "published" });

    const res = await app.inject({ method: "GET", url: "/api/v1/notes" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ title: string; project: { slug: string }; tags: string[] }> };
    expect(body.items.map((i) => i.title)).toEqual(["可见笔记"]);
    expect(body.items[0].project.slug).toBe(pub.slug);
    expect(body.items[0].tags).toEqual(["复盘"]);
  });

  it("按 tag / search 过滤", async () => {
    const project = await createProject(app, token, { name: "项目", publish_status: "published" });
    await createNote(app, token, {
      project_id: project.id,
      title: "Vue 复盘",
      body_md: "关于响应式的笔记",
      publish_status: "published",
      tags: ["前端"],
    });
    await createNote(app, token, {
      project_id: project.id,
      title: "后端复盘",
      body_md: "关于 SQL 的笔记",
      publish_status: "published",
      tags: ["后端"],
    });

    const byTag = await app.inject({ method: "GET", url: "/api/v1/notes?tag=前端" });
    expect((byTag.json() as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(["Vue 复盘"]);

    const byBody = await app.inject({ method: "GET", url: "/api/v1/notes?search=SQL" });
    expect((byBody.json() as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(["后端复盘"]);
  });

  it("详情返回 body_md；草稿笔记 404", async () => {
    const project = await createProject(app, token, { name: "项目", publish_status: "published" });
    const published = await createNote(app, token, {
      project_id: project.id,
      title: "已发布",
      body_md: "## 小标题",
      publish_status: "published",
    });
    const draft = await createNote(app, token, { project_id: project.id, title: "草稿" });

    const ok = await app.inject({ method: "GET", url: `/api/v1/notes/${published.slug}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().body_md).toBe("## 小标题");

    const hidden = await app.inject({ method: "GET", url: `/api/v1/notes/${draft.slug}` });
    expect(hidden.statusCode).toBe(404);
  });

  it("笔记改名后旧 slug 301", async () => {
    const project = await createProject(app, token, { name: "项目", publish_status: "published" });
    const note = await createNote(app, token, { project_id: project.id, publish_status: "published" });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/notes/${note.id}`,
      headers: auth(token),
      payload: { slug: "note-renamed" },
    });

    const res = await app.inject({ method: "GET", url: `/api/v1/notes/${note.slug}` });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe("/api/v1/notes/note-renamed");
  });
});

describe("GET /api/v1/technologies", () => {
  it("只汇总前台可见项目的技术栈，逗号去重", async () => {
    await createProject(app, token, { name: "公开1", publish_status: "published", tech_stack: ["Vue", "Vite"] });
    await createProject(app, token, { name: "公开2", publish_status: "published", tech_stack: ["Vue"] });
    await createProject(app, token, { name: "草稿", tech_stack: ["SecretTech"] });

    const res = await app.inject({ method: "GET", url: "/api/v1/technologies" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(["Vite", "Vue"]);
  });
});
