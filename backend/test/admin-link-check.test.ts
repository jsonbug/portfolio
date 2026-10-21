// 后台链接健康检查接口（B16）：POST /admin/links/:id/check、保存后自动检查
// 用本地 mock server + 注入解析器，不触碰公网。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { auth, createProject, getToken, wipeDb } from "./helpers.js";
import { defaultLinkCheckOptions, linkCheckRuntime, waitForLinkChecks } from "../src/lib/link-check.js";

let app: FastifyInstance;
let token: string;
let server: Server;
let base: string;
let hits: string[] = [];

beforeAll(async () => {
  app = buildApp();
  token = await getToken(app);
  server = createServer((req, res) => {
    const url = req.url ?? "";
    hits.push(url);
    if (url === "/ok") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
});

beforeEach(async () => {
  await wipeDb();
  hits = [];
  delete process.env.LINK_CHECK_ENABLED;
  // 仅测试：mock server 的环回地址视为已校验（生产 resolver 会拒绝）
  linkCheckRuntime.options = {
    ...defaultLinkCheckOptions,
    hopTimeoutMs: 500,
    totalTimeoutMs: 3000,
    resolve: async () => ({ address: "127.0.0.1", family: 4 }),
  };
});

afterEach(() => {
  linkCheckRuntime.options = { ...defaultLinkCheckOptions };
  delete process.env.LINK_CHECK_ENABLED;
});

const addLink = (projectId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/api/v1/admin/projects/${projectId}/links`,
    headers: auth(token),
    payload,
  });

const checkLink = (linkId: string) =>
  app.inject({ method: "POST", url: `/api/v1/admin/links/${linkId}/check`, headers: auth(token) });

describe("POST /api/v1/admin/links/:id/check", () => {
  it("2xx → last_status=ok，写回 http 状态码与检查时间", async () => {
    const p = await createProject(app, token, { name: "重检" });
    const link = (await addLink(p.id, { type: "repo", url: `${base}/ok` })).json() as {
      id: string;
      last_status: string;
    };
    expect(link.last_status).toBe("unknown"); // 自动检查在测试环境默认关闭

    const res = await checkLink(link.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ last_status: "ok", last_http_status: 200 });
    expect(typeof body.last_checked_at).toBe("string");
    expect(hits).toEqual(["/ok"]);
  });

  it("非 2xx → last_status=failed，仍记录 HTTP 状态码", async () => {
    const p = await createProject(app, token, { name: "失败" });
    const link = (await addLink(p.id, { type: "site", url: `${base}/broken` })).json() as { id: string };

    const res = await checkLink(link.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ last_status: "failed", last_http_status: 500 });
  });

  it("私网目标 → failed 且一次请求都不发（SSRF 拦截）", async () => {
    // 换回生产 resolver：mock server 在 127.0.0.1，必须被拒绝
    linkCheckRuntime.options = { ...defaultLinkCheckOptions, hopTimeoutMs: 500 };
    const p = await createProject(app, token, { name: "私网" });
    const link = (await addLink(p.id, { type: "site", url: `${base}/ok` })).json() as { id: string };

    const res = await checkLink(link.id);
    expect(res.json()).toMatchObject({ last_status: "failed", last_http_status: null });
    expect(hits).toEqual([]);
  });

  it("结果落库：项目详情里能看到检查后的状态", async () => {
    const p = await createProject(app, token, { name: "落库" });
    const link = (await addLink(p.id, { type: "docs", url: `${base}/ok` })).json() as { id: string };
    await checkLink(link.id);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${p.id}`,
      headers: auth(token),
    });
    const links = detail.json().links as Array<Record<string, unknown>>;
    expect(links[0]).toMatchObject({ last_status: "ok", last_http_status: 200 });
  });

  it("重检只改健康检查字段，不动 url/type/label/sort", async () => {
    const p = await createProject(app, token, { name: "只读字段" });
    const link = (await addLink(p.id, { type: "demo", url: `${base}/ok`, label: "演示", sort: 7 })).json() as {
      id: string;
    };

    const body = (await checkLink(link.id)).json() as Record<string, unknown>;
    expect(body).toMatchObject({ url: `${base}/ok`, type: "demo", label: "演示", sort: 7 });
  });

  it("链接不存在 → 404", async () => {
    const res = await checkLink("no-such-link");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("未鉴权 → 401", async () => {
    const p = await createProject(app, token, { name: "鉴权" });
    const link = (await addLink(p.id, { type: "repo", url: `${base}/ok` })).json() as { id: string };
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/links/${link.id}/check` });
    expect(res.statusCode).toBe(401);
  });
});

describe("保存链接后的自动检查", () => {
  it("LINK_CHECK_ENABLED=1：新增链接后台检查并落库", async () => {
    process.env.LINK_CHECK_ENABLED = "1";
    const p = await createProject(app, token, { name: "自动检查" });
    await addLink(p.id, { type: "repo", url: `${base}/ok` });
    await waitForLinkChecks();

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${p.id}`,
      headers: auth(token),
    });
    expect((detail.json().links as Array<Record<string, unknown>>)[0]).toMatchObject({
      last_status: "ok",
      last_http_status: 200,
    });
  });

  it("PATCH 改 url 触发重检；只改标签不触发", async () => {
    process.env.LINK_CHECK_ENABLED = "1";
    const p = await createProject(app, token, { name: "patch" });
    const link = (await addLink(p.id, { type: "repo", url: `${base}/ok` })).json() as { id: string };
    await waitForLinkChecks();

    hits = [];
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${link.id}`,
      headers: auth(token),
      payload: { label: "只改标签" },
    });
    await waitForLinkChecks();
    expect(hits).toEqual([]); // 未改 url，不打网络

    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/links/${link.id}`,
      headers: auth(token),
      payload: { url: `${base}/broken` },
    });
    await waitForLinkChecks();
    expect(hits).toEqual(["/broken"]);
  });

  it("测试环境默认关闭自动检查，保存后保持 unknown", async () => {
    const p = await createProject(app, token, { name: "默认关闭" });
    const link = (await addLink(p.id, { type: "repo", url: `${base}/ok` })).json() as {
      last_status: string;
      last_checked_at: unknown;
    };
    await waitForLinkChecks();
    expect(link).toMatchObject({ last_status: "unknown", last_checked_at: null });
    expect(hits).toEqual([]);
  });
});
