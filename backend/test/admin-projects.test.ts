import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { auth, getToken, wipeDb } from "./helpers.js";

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  await wipeDb();
  app = buildApp();
  token = await getToken(app);
});

afterAll(async () => {
  await app.close();
});

async function createProject(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/v1/admin/projects",
    headers: auth(token),
    payload: { name: "测试项目", ...payload },
  });
}

describe("2.2 项目 CRUD", () => {
  it("创建项目：默认 draft、无技术栈、无笔记、未删除", async () => {
    const res = await createProject({ name: "博客系统" });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.name).toBe("博客系统");
    expect(body.status).toBe("draft");
    expect(body.technologies).toEqual([]);
    expect(body.note).toBeNull();
    expect(body.deletedAt).toBeNull();
  });

  it("创建项目：缺 name 返回 400", async () => {
    const res = await createProject({ name: undefined });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("创建项目：非法 status 返回 400", async () => {
    const res = await createProject({ status: "published2" });
    expect(res.statusCode).toBe(400);
  });

  it("创建项目：coverImage 可写并返回原值", async () => {
    const res = await createProject({ coverImage: "https://example.com/cover.webp" });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { coverImage: string }).coverImage).toBe(
      "https://example.com/cover.webp",
    );
  });

  it("创建项目：不传 coverImage 默认 null", async () => {
    const res = await createProject({ name: "无封面" });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { coverImage: string | null }).coverImage).toBeNull();
  });

  it("创建项目：coverImage 显式传 null 返回 null", async () => {
    const res = await createProject({ name: "空封面", coverImage: null });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { coverImage: string | null }).coverImage).toBeNull();
  });

  it("创建项目：coverImage 非法协议返回 400", async () => {
    const res = await createProject({ coverImage: "ftp://example.com/x.png" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("创建项目：coverImage 超长（>2048）返回 400", async () => {
    const res = await createProject({ coverImage: `https://example.com/${"a".repeat(2100)}` });
    expect(res.statusCode).toBe(400);
  });

  it("更新：PATCH coverImage 覆盖，显式 null 清空", async () => {
    const created = await createProject({ coverImage: "https://example.com/a.webp" });
    const id = (created.json() as { id: string }).id;

    const upd = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { coverImage: "https://example.com/b.webp" },
    });
    expect(upd.statusCode).toBe(200);
    expect((upd.json() as { coverImage: string }).coverImage).toBe(
      "https://example.com/b.webp",
    );

    const clear = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { coverImage: null },
    });
    expect(clear.statusCode).toBe(200);
    expect((clear.json() as { coverImage: string | null }).coverImage).toBeNull();
  });

  it("创建项目：携带元数据与技术栈，/technologies 可见", async () => {
    const res = await createProject({
      name: "含技术栈",
      status: "published",
      stars: 12,
      role: "全栈",
      projectStatus: "active",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      technologies: ["Vue", "Node.js"],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.technologies).toEqual(["Vue", "Node.js"]);
    expect(body.stars).toBe(12);
    expect(body.projectStatus).toBe("active");

    const techRes = await app.inject({ method: "GET", url: "/api/v1/technologies" });
    const techBody = techRes.json() as { items: string[] };
    expect(techBody.items).toContain("Vue");
    expect(techBody.items).toContain("Node.js");
  });

  it("列表：分页字段 + 分页上限", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?page=1&pageSize=5",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string }>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(5);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("列表：status 过滤只返回对应状态", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?status=published",
      headers: auth(token),
    });
    const body = res.json() as { items: Array<{ status: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.status).toBe("published");
    }
  });

  it("列表：search 按名称模糊过滤", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?search=博客",
      headers: auth(token),
    });
    const body = res.json() as { items: Array<{ name: string }> };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) {
      expect(item.name).toContain("博客");
    }
  });

  it("详情：包含 description/links/note 字段", async () => {
    const created = await createProject({ name: "详情项目", description: "一段**Markdown**描述" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.description).toBe("一段**Markdown**描述");
    expect(body.links).toEqual([]);
    expect(body.note).toBeNull();
  });

  it("详情：不存在返回 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects/does-not-exist",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("更新：改名 + 发布（status=published）", async () => {
    const created = await createProject({ name: "待发布" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { name: "已发布", status: "published" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.name).toBe("已发布");
    expect(body.status).toBe("published");
  });

  it("更新：下架（status=archived）", async () => {
    const created = await createProject({ name: "要下架", status: "published" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "archived" },
    });
    expect((res.json() as { status: string }).status).toBe("archived");
  });

  it("状态机：draft→archived 跨级返回 400 INVALID_STATUS_TRANSITION", async () => {
    const created = await createProject({ name: "跨级1" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "archived" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("状态机：published→draft 回退草稿返回 400", async () => {
    const created = await createProject({ name: "回退", status: "published" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "draft" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("状态机：archived→published 重新上架返回 200", async () => {
    const created = await createProject({ name: "重新上架", status: "published" });
    const id = (created.json() as { id: string }).id;
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "archived" },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "published" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("published");
  });

  it("状态机：相同状态 no-op 不报错", async () => {
    const created = await createProject({ name: "同名", status: "published" });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { status: "published", tagline: "改个标签" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { tagline: string }).tagline).toBe("改个标签");
  });

  it("更新：技术栈全量替换", async () => {
    const created = await createProject({ name: "换技术栈", technologies: ["Vue"] });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
      payload: { technologies: ["React"] },
    });
    expect((res.json() as { technologies: string[] }).technologies).toEqual(["React"]);
  });

  it("更新：不存在返回 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/projects/nope",
      headers: auth(token),
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("软删除 + 列表默认隐藏 + includeDeleted 可见 + 恢复", async () => {
    const created = await createProject({ name: "软删除项目" });
    const id = (created.json() as { id: string }).id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/projects/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(204);

    const defaultList = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects",
      headers: auth(token),
    });
    const defaultNames = (defaultList.json() as { items: Array<{ id: string }> }).items.map(
      (i) => i.id,
    );
    expect(defaultNames).not.toContain(id);

    const withDeleted = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects?includeDeleted=true",
      headers: auth(token),
    });
    const deletedItem = (withDeleted.json() as { items: Array<{ id: string; deletedAt: string | null }> }).items.find(
      (i) => i.id === id,
    );
    expect(deletedItem).toBeDefined();
    expect(deletedItem?.deletedAt).not.toBeNull();

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${id}/restore`,
      headers: auth(token),
    });
    expect(restore.statusCode).toBe(200);
    expect((restore.json() as { deletedAt: string | null }).deletedAt).toBeNull();
  });

  it("软删除不存在的项目返回 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/projects/ghost",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(404);
  });
});
