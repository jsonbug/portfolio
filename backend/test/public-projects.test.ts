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

// 通过后台接口造数据（需鉴权），再走公开接口读（无需鉴权）
async function createProject(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/projects",
    headers: auth(token),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string } & Record<string, unknown>;
}

async function softDelete(id: string) {
  const res = await app.inject({
    method: "DELETE",
    url: `/api/v1/admin/projects/${id}`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(204);
}

describe("3.1 公开项目读接口", () => {
  it("列表：仅返回 published 且未软删除，响应不含 deletedAt", async () => {
    await createProject({ name: "草稿项目", status: "draft" });
    await createProject({ name: "已发布项目", status: "published", coverImage: "https://e.com/c.webp" });
    await createProject({ name: "下架项目", status: "archived" });
    const del = await createProject({ name: "已删已发布", status: "published" });
    await softDelete(del.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>>; total: number };
    const names = body.items.map((i) => i.name);
    expect(names).toContain("已发布项目");
    expect(names).not.toContain("草稿项目");
    expect(names).not.toContain("下架项目");
    expect(names).not.toContain("已删已发布");

    // 公开序列化：无 deletedAt，且 coverImage 公开返回
    const pub = body.items.find((i) => i.name === "已发布项目");
    expect(pub).toBeDefined();
    expect("deletedAt" in (pub as object)).toBe(false);
    expect(pub?.coverImage).toBe("https://e.com/c.webp");
  });

  it("列表：search 按名称/简介模糊过滤", async () => {
    await createProject({ name: "搜索目标Alpha", tagline: "独特简介Beta", status: "published" });
    await createProject({ name: "无关项目", status: "published" });

    const byName = await app.inject({ method: "GET", url: "/api/v1/projects?search=Alpha" });
    const byNameBody = byName.json() as { items: Array<{ name: string }> };
    expect(byNameBody.items.length).toBe(1);
    expect(byNameBody.items[0].name).toBe("搜索目标Alpha");

    const byTagline = await app.inject({ method: "GET", url: "/api/v1/projects?search=独特简介" });
    const byTaglineBody = byTagline.json() as { items: Array<{ name: string }> };
    expect(byTaglineBody.items.map((i) => i.name)).toContain("搜索目标Alpha");
  });

  it("列表：technology 技术栈名精确过滤", async () => {
    await createProject({ name: "Vue项目", status: "published", technologies: ["Vue", "Node.js"] });
    await createProject({ name: "React项目", status: "published", technologies: ["React"] });

    const res = await app.inject({ method: "GET", url: "/api/v1/projects?technology=Vue" });
    const body = res.json() as { items: Array<{ name: string }> };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) expect(item.name).toBe("Vue项目");

    // 精确匹配：模糊 "Vu" 不应命中
    const fuzzy = await app.inject({ method: "GET", url: "/api/v1/projects?technology=Vu" });
    expect((fuzzy.json() as { total: number }).total).toBe(0);
  });

  it("列表：默认排序 lastActivityAt desc，空回退 updatedAt", async () => {
    await createProject({
      name: "排序A-老活动",
      status: "published",
      lastActivityAt: "2024-01-01",
    });
    await createProject({ name: "排序B-无活动", status: "published" }); // lastActivityAt 为 null → 回退 updatedAt(现在)

    const res = await app.inject({ method: "GET", url: "/api/v1/projects?search=排序" });
    const body = res.json() as { items: Array<{ name: string }> };
    expect(body.items.length).toBe(2);
    // "排序B"（null → updatedAt=现在）应排在 "排序A"（lastActivityAt=2024）之前
    expect(body.items[0].name).toBe("排序B-无活动");
    expect(body.items[1].name).toBe("排序A-老活动");
  });

  it("列表：分页字段（page/pageSize/total/totalPages）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/projects?page=1&pageSize=2" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: unknown[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.totalPages).toBe(Math.ceil(body.total / 2));
  });

  it("详情：published 返回 description/links/note，不含 deletedAt", async () => {
    const created = await createProject({
      name: "详情公开",
      status: "published",
      description: "一段**Markdown**描述",
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${created.id}/links`,
      headers: auth(token),
      payload: { type: "repo", url: "https://github.com/jsonbug" },
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${created.id}/note`,
      headers: auth(token),
      payload: { title: "笔记标题", content: "# 内容" },
    });

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${created.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.name).toBe("详情公开");
    expect(body.description).toBe("一段**Markdown**描述");
    expect(Array.isArray(body.links)).toBe(true);
    expect((body.links as Array<{ type: string }>).length).toBe(1);
    expect((body.note as { title: string }).title).toBe("笔记标题");
    expect("deletedAt" in body).toBe(false);
  });

  it("详情：draft / archived / 已软删除 / 不存在 均返回 404", async () => {
    const draft = await createProject({ name: "详情草稿", status: "draft" });
    const archived = await createProject({ name: "详情下架", status: "archived" });
    const del = await createProject({ name: "详情已删", status: "published" });
    await softDelete(del.id);

    for (const id of [draft.id, archived.id, del.id, "does-not-exist"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/projects/${id}` });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    }
  });

  it("公开接口无需鉴权（无 Bearer 亦可访问）", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(list.statusCode).toBe(200);
  });
});
