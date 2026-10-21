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
    payload: { name: "笔记项目" },
  });
  return (res.json() as { id: string }).id;
}

describe("2.5 笔记管理（1:1）", () => {
  it("创建笔记 → 200，内容可读回", async () => {
    const projectId = await createProject();
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
      payload: { title: "笔记标题", content: "# Markdown 正文" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.title).toBe("笔记标题");
    expect(body.content).toBe("# Markdown 正文");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${projectId}`,
      headers: auth(token),
    });
    expect((detail.json() as { note: { title: string } }).note.title).toBe("笔记标题");
  });

  it("再次 PUT 为幂等替换（仍是 1 篇笔记）", async () => {
    const projectId = await createProject();
    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
      payload: { title: "第一版", content: "v1" },
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
      payload: { title: "第二版", content: "v2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { title: string; content: string };
    expect(body.title).toBe("第二版");
    expect(body.content).toBe("v2");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${projectId}`,
      headers: auth(token),
    });
    expect((detail.json() as { note: { title: string } }).note.title).toBe("第二版");
  });

  it("创建笔记：空 content 返回 400", async () => {
    const projectId = await createProject();
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
      payload: { title: "t", content: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("创建笔记：项目不存在返回 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/projects/ghost/note",
      headers: auth(token),
      payload: { title: "t", content: "c" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("删除笔记 → 204，详情 note 为空", async () => {
    const projectId = await createProject();
    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
      payload: { title: "待删除", content: "c" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/projects/${projectId}/note`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${projectId}`,
      headers: auth(token),
    });
    expect((detail.json() as { note: unknown }).note).toBeNull();
  });
});
