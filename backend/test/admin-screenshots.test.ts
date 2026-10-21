// 项目截图（F2）与元数据 kind（F2 指标卡）：排序、上限、协议校验、整体替换、updated_at bump
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

const putScreenshots = (id: string, payload: unknown) =>
  app.inject({
    method: "PUT",
    url: `/api/v1/admin/projects/${id}/screenshots`,
    headers: auth(token),
    payload: payload as never,
  });

const putMetadata = (id: string, payload: unknown) =>
  app.inject({
    method: "PUT",
    url: `/api/v1/admin/projects/${id}/metadata`,
    headers: auth(token),
    payload: payload as never,
  });

const shot = (n: number, extra: Record<string, unknown> = {}) => ({
  url: `https://cdn.example.com/shot-${n}.png`,
  ...extra,
});

describe("PUT /api/v1/admin/projects/:id/screenshots", () => {
  it("写入后按 sort 升序返回，未给 sort 时用数组下标", async () => {
    const p = await createProject(app, token, { name: "截图项目" });
    const res = await putScreenshots(p.id, [
      shot(1, { caption: "首页", sort: 2 }),
      shot(2, { caption: null, sort: 0 }),
      shot(3),
    ]);
    expect(res.statusCode).toBe(200);
    const shots = res.json().screenshots as Array<{ url: string; caption: string | null; sort: number }>;
    expect(shots.map((s) => s.sort)).toEqual([0, 2, 2]);
    expect(shots[0].url).toBe("https://cdn.example.com/shot-2.png");
    expect(shots[0].caption).toBeNull();
    expect(shots[1].caption).toBe("首页");
  });

  it("整体替换：第二次提交会清掉第一次的行（含图注）", async () => {
    const p = await createProject(app, token, { name: "替换项目" });
    await putScreenshots(p.id, [shot(1, { caption: "旧图" }), shot(2)]);
    const res = await putScreenshots(p.id, [shot(9, { caption: "新图" })]);
    const shots = res.json().screenshots as Array<{ url: string; caption: string | null }>;
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ url: "https://cdn.example.com/shot-9.png", caption: "新图" });
    expect(await prisma.projectScreenshot.count({ where: { project_id: p.id } })).toBe(1);
  });

  it("传空数组即清空", async () => {
    const p = await createProject(app, token, { name: "清空项目" });
    await putScreenshots(p.id, [shot(1)]);
    const res = await putScreenshots(p.id, []);
    expect(res.json().screenshots).toEqual([]);
  });

  it("超过 10 张 400", async () => {
    const p = await createProject(app, token, { name: "超限项目" });
    const res = await putScreenshots(
      p.id,
      Array.from({ length: 11 }, (_, i) => shot(i)),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].message).toContain("10");
  });

  it("10 张正好通过（边界）", async () => {
    const p = await createProject(app, token, { name: "十张项目" });
    const res = await putScreenshots(
      p.id,
      Array.from({ length: 10 }, (_, i) => shot(i)),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().screenshots).toHaveLength(10);
  });

  it("非 http(s) 协议 400（javascript: / data: / 相对路径 / ftp）", async () => {
    const p = await createProject(app, token, { name: "协议项目" });
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AAA", "/local.png", "ftp://x/y.png"]) {
      const res = await putScreenshots(p.id, [{ url }]);
      expect(res.statusCode, url).toBe(400);
    }
  });

  // 原来这三条全部入库并从前台原样下发（`GET /projects/:slug` → `['https://', 'http://e.com/a b.png']`）：
  // 后台「保存成功」、前台空白格，没有任何错误信号。
  it("前缀合法但落不了地的地址 400（无主机 / 含空白 / 协议相对）", async () => {
    const p = await createProject(app, token, { name: "坏地址项目" });
    for (const url of ["https://", "http://e.com/a b.png", "//e.com/a.png"]) {
      const res = await putScreenshots(p.id, [{ url }]);
      expect(res.statusCode, url).toBe(400);
      expect(JSON.stringify(res.json().error.details), url).toContain("url");
    }
  });

  it("图注超过 80 字 400", async () => {
    const p = await createProject(app, token, { name: "图注项目" });
    expect((await putScreenshots(p.id, [shot(1, { caption: "字".repeat(80) })])).statusCode).toBe(200);
    expect((await putScreenshots(p.id, [shot(1, { caption: "字".repeat(81) })])).statusCode).toBe(400);
  });

  it("空白图注归一为 null（前端只需处理 null 一种「无图注」）", async () => {
    const p = await createProject(app, token, { name: "空图注" });
    const res = await putScreenshots(p.id, [shot(1, { caption: "   " }), shot(2)]);
    const shots = res.json().screenshots as Array<{ caption: string | null }>;
    expect(shots.map((s) => s.caption)).toEqual([null, null]);
  });

  it("替换后 bump updated_at（前台 recent 排序要能看见内容变更）", async () => {
    const p = await createProject(app, token, { name: "时间戳项目" });
    const before = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await putScreenshots(p.id, [shot(1)]);
    const after = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("项目不存在 404", async () => {
    const res = await putScreenshots("no-such-id", [shot(1)]);
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/projects/:slug 带 screenshots", () => {
  it("前台详情按 sort 升序返回截图；无截图时为 []", async () => {
    const withShots = await createProject(app, token, {
      name: "详情截图",
      publish_status: "published",
    });
    await putScreenshots(withShots.id, [shot(1, { sort: 1 }), shot(2, { sort: 0 })]);

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${withShots.slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.screenshots.map((s: { sort: number }) => s.sort)).toEqual([0, 1]);
    expect(Object.keys(body.screenshots[0]).sort()).toEqual(["caption", "id", "sort", "url"]);

    const bare = await createProject(app, token, { name: "无截图", publish_status: "published" });
    const bareRes = await app.inject({ method: "GET", url: `/api/v1/projects/${bare.slug}` });
    expect(bareRes.json().screenshots).toEqual([]);
  });

  it("草稿项目的截图不出现在前台（404 整个详情不可见）", async () => {
    const p = await createProject(app, token, { name: "草稿截图" });
    await putScreenshots(p.id, [shot(1)]);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${p.slug}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/v1/admin/projects/:id/metadata 的 kind", () => {
  it("不传 kind 时缺省 meta（旧请求体照常通过）", async () => {
    const p = await createProject(app, token, { name: "旧请求体" });
    const res = await putMetadata(p.id, [{ key_label: "角色", value: "全栈" }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().metadata).toEqual([{ key_label: "角色", value: "全栈", kind: "meta", sort: 0 }]);
  });

  it("metric 条目被保存并回读", async () => {
    const p = await createProject(app, token, { name: "指标项目" });
    const res = await putMetadata(p.id, [
      { key_label: "版本", value: "v2.3", kind: "metric" },
      { key_label: "角色", value: "全栈", kind: "meta" },
    ]);
    const items = res.json().metadata as Array<{ key_label: string; kind: string }>;
    expect(items.map((i) => `${i.key_label}:${i.kind}`)).toEqual(["版本:metric", "角色:meta"]);
  });

  it("metric 超过 2 条 400", async () => {
    const p = await createProject(app, token, { name: "指标超限" });
    const res = await putMetadata(p.id, [
      { key_label: "A", value: "1", kind: "metric" },
      { key_label: "B", value: "2", kind: "metric" },
      { key_label: "C", value: "3", kind: "metric" },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.some((d: { message: string }) => d.message.includes("最多 2 条"))).toBe(true);
  });

  it("metric 的 key_label >16 / value >12 拒绝，meta 同长度可以通过", async () => {
    const p = await createProject(app, token, { name: "指标长度" });
    const longLabel = "标签".repeat(9); // 18 字
    expect((await putMetadata(p.id, [{ key_label: longLabel, value: "1", kind: "metric" }])).statusCode).toBe(400);
    expect((await putMetadata(p.id, [{ key_label: "版本", value: "v".repeat(13), kind: "metric" }])).statusCode).toBe(
      400,
    );
    // 同样内容走 meta 不受限（meta 上限 50 / 500）
    expect((await putMetadata(p.id, [{ key_label: longLabel, value: "v".repeat(13) }])).statusCode).toBe(200);
  });

  it("键名重复仍然 400（原有 B6 约束不因 kind 改动回退）", async () => {
    const p = await createProject(app, token, { name: "重复键名" });
    const res = await putMetadata(p.id, [
      { key_label: "A", value: "1" },
      { key_label: "A", value: "2", kind: "metric" },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.some((d: { message: string }) => d.message.includes("不可重复"))).toBe(true);
  });

  it("整体替换后 bump updated_at", async () => {
    const p = await createProject(app, token, { name: "元数据时间戳" });
    const before = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await putMetadata(p.id, [{ key_label: "A", value: "1" }]);
    const after = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("截图的 caption 与 metadata 的 kind 在同一次响应里都带（后台详情形状）", async () => {
    const p = await createProject(app, token, { name: "形状项目" });
    await putScreenshots(p.id, [shot(1, { caption: "图一" })]);
    const res = await putMetadata(p.id, [{ key_label: "版本", value: "v1", kind: "metric" }]);
    const body = res.json();
    expect(body.screenshots[0].caption).toBe("图一");
    expect(body.metadata[0].kind).toBe("metric");
  });
});
