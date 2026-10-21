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

async function createProject(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/projects",
    headers: auth(token),
    payload: { name: "链接项目" },
  });
  return (res.json() as { id: string }).id;
}

describe("2.4 链接管理", () => {
  it("添加链接 → 201，出现在项目详情", async () => {
    const projectId = await createProject();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${projectId}/links`,
      headers: auth(token),
      payload: { type: "repo", label: "GitHub", url: "https://github.com/jsonbug/multica-demo" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.type).toBe("repo");
    expect(body.url).toBe("https://github.com/jsonbug/multica-demo");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${projectId}`,
      headers: auth(token),
    });
    const links = (detail.json() as { links: Array<{ id: string }> }).links;
    expect(links).toHaveLength(1);
    expect(links[0]?.id).toBe(body.id);
  });

  it("添加链接：非法 url 返回 400", async () => {
    const projectId = await createProject();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${projectId}/links`,
      headers: auth(token),
      payload: { type: "repo", url: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("添加链接：非 http/https 协议（ftp/mailto）返回 400", async () => {
    const projectId = await createProject();
    for (const bad of ["ftp://example.com", "mailto:a@b.com", "javascript:alert(1)"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/projects/${projectId}/links`,
        headers: auth(token),
        payload: { type: "other", url: bad },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("添加链接：项目不存在返回 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/projects/ghost/links",
      headers: auth(token),
      payload: { type: "other", url: "https://example.com" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("更新链接：改类型与标签", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${projectId}/links`,
      headers: auth(token),
      payload: { type: "other", url: "https://example.com" },
    });
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${id}`,
      headers: auth(token),
      payload: { type: "website", label: "官网" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.type).toBe("website");
    expect(body.label).toBe("官网");
    expect(body.url).toBe("https://example.com");
  });

  it("更新不存在链接返回 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/links/ghost",
      headers: auth(token),
      payload: { type: "website" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("删除链接 → 204，详情不再包含", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/admin/projects/${projectId}/links`,
      headers: auth(token),
      payload: { type: "demo", url: "https://demo.example.com" },
    });
    const id = (created.json() as { id: string }).id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/links/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${projectId}`,
      headers: auth(token),
    });
    expect((detail.json() as { links: unknown[] }).links).toHaveLength(0);
  });
});
