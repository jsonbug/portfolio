// 后台链接接口：v1.2 类型枚举（website → site）、http/https 校验、sort 追加、增删改
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
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

const addLink = (projectId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/api/v1/admin/projects/${projectId}/links`,
    headers: auth(token),
    payload,
  });

describe("POST /api/v1/admin/projects/:id/links", () => {
  it("新增链接：sort 缺省追加到末尾，健康检查字段初始为 null", async () => {
    const p = await createProject(app, token, { name: "链接项目" });
    const first = await addLink(p.id, { type: "repo", url: "https://github.com/a/b", label: "GitHub" });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      type: "repo",
      label: "GitHub",
      sort: 0,
      last_status: "unknown",
      last_http_status: null,
      last_checked_at: null,
    });

    const second = await addLink(p.id, { type: "site", url: "https://a.example.com" });
    expect(second.json().sort).toBe(1);
  });

  it("v1.2 类型枚举：接受 repo/site/docs/demo/other，拒绝旧值 website → 400", async () => {
    const p = await createProject(app, token, { name: "类型" });

    for (const type of ["repo", "site", "docs", "demo", "other"]) {
      const res = await addLink(p.id, { type, url: "https://e.com" });
      expect(res.statusCode).toBe(201);
    }

    const legacy = await addLink(p.id, { type: "website", url: "https://e.com" });
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("非 http/https 链接 → 400", async () => {
    const p = await createProject(app, token, { name: "协议" });
    for (const url of ["ftp://e.com/x", "mailto:a@b.com", "javascript:alert(1)", "not-a-url"]) {
      const res = await addLink(p.id, { type: "other", url });
      expect(res.statusCode).toBe(400);
    }
  });

  it("项目不存在 → 404", async () => {
    const res = await addLink("no-such-project", { type: "repo", url: "https://e.com" });
    expect(res.statusCode).toBe(404);
  });

  it("未鉴权 → 401", async () => {
    const p = await createProject(app, token, { name: "鉴权" });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${p.id}/links`,
      payload: { type: "repo", url: "https://e.com" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH / DELETE /api/v1/admin/links/:id", () => {
  it("更新类型/标签/url/sort", async () => {
    const p = await createProject(app, token, { name: "更新" });
    const link = (await addLink(p.id, { type: "repo", url: "https://e.com/a" })).json() as { id: string };

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${link.id}`,
      headers: auth(token),
      payload: { type: "demo", label: "在线演示", sort: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: "demo", label: "在线演示", sort: 5, url: "https://e.com/a" });
  });

  it("更新为非法类型/url → 400", async () => {
    const p = await createProject(app, token, { name: "更新非法" });
    const link = (await addLink(p.id, { type: "repo", url: "https://e.com" })).json() as { id: string };

    const badType = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${link.id}`,
      headers: auth(token),
      payload: { type: "website" },
    });
    expect(badType.statusCode).toBe(400);

    const badUrl = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${link.id}`,
      headers: auth(token),
      payload: { url: "ftp://e.com" },
    });
    expect(badUrl.statusCode).toBe(400);
  });

  it("删除：204，重复删除 404", async () => {
    const p = await createProject(app, token, { name: "删除" });
    const link = (await addLink(p.id, { type: "repo", url: "https://e.com" })).json() as { id: string };

    const first = await app.inject({ method: "DELETE", url: `/api/v1/admin/links/${link.id}`, headers: auth(token) });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({ method: "DELETE", url: `/api/v1/admin/links/${link.id}`, headers: auth(token) });
    expect(second.statusCode).toBe(404);
  });

  it("链接只出现在所属项目详情里，且公开详情不含健康检查以外的后台字段", async () => {
    const p = await createProject(app, token, { name: "公开链接", publish_status: "published" });
    await addLink(p.id, { type: "site", url: "https://demo.example.com", label: "官网" });

    const detail = await app.inject({ method: "GET", url: `/api/v1/projects/${p.slug}` });
    const links = detail.json().links as Array<Record<string, unknown>>;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: "site", label: "官网", url: "https://demo.example.com" });
  });
});
