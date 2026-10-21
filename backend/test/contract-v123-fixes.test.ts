// 契约 v1.2.3 两项修复的回归测试（跨端接管 batch）：
//   1) search 按字面量匹配：`%` / `_` 不能当 LIKE 通配符
//   2) NoteSummary.excerpt：公开列表 / 详情 / 后台三条路径都带，空正文 null、长正文 121 字（120 + 省略号）
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

const get = (url: string) => app.inject({ method: "GET", url: `/api/v1${url}` });

describe("search 按字面量匹配（% 与 _ 不是通配符）", () => {
  it("项目列表：search=100% 只命中名字里真有 100% 的项目", async () => {
    await createProject(app, token, { name: "折扣 100% 项目", publish_status: "published" });
    await createProject(app, token, { name: "只有数字 100 的项目", publish_status: "published" });
    await createProject(app, token, { name: "完全无关", summary: "提到 100% 的地方", publish_status: "published" });

    const percent = await get("/projects?search=100%25");
    expect(percent.statusCode).toBe(200);
    // 通配符话术下 `%` 会让模式退化成 "100%" 之外的一切，这里必须恰好是两条字面命中
    expect(percent.json().items.map((i: { name: string }) => i.name).sort()).toEqual([
      "完全无关",
      "折扣 100% 项目",
    ]);

    // 每个字符都是通配符时，未转义的实现会命中全部 3 条
    const onlyWild = await get("/projects?search=%25");
    expect(onlyWild.json().items.map((i: { name: string }) => i.name).sort()).toEqual([
      "完全无关",
      "折扣 100% 项目",
    ]);
  });

  it("项目列表：search=a_b 不会把 aXb 也算命中", async () => {
    await createProject(app, token, { name: "a_b 下划线项目", publish_status: "published" });
    await createProject(app, token, { name: "axb 无下划线", publish_status: "published" });

    const res = await get("/projects?search=a_b");
    expect(res.json().items.map((i: { name: string }) => i.name)).toEqual(["a_b 下划线项目"]);
  });

  it("笔记列表：search 同样按字面量，% 与 _ 都不当通配符", async () => {
    const project = await createProject(app, token, { name: "所属项目", publish_status: "published" });
    await createNote(app, token, {
      project_id: project.id,
      title: "进度 100% 完成",
      body_md: "正文",
      publish_status: "published",
    });
    await createNote(app, token, {
      project_id: project.id,
      title: "进度 100 完成",
      body_md: "正文",
      publish_status: "published",
    });

    const percent = await get("/notes?search=100%25");
    expect(percent.json().items.map((i: { title: string }) => i.title)).toEqual(["进度 100% 完成"]);

    // `_` 若当通配符，"a_b" 会命中 "axb"
    await createNote(app, token, {
      project_id: project.id,
      title: "a_b 下划线",
      body_md: "正文",
      publish_status: "published",
    });
    await createNote(app, token, {
      project_id: project.id,
      title: "axb 不是下划线",
      body_md: "正文",
      publish_status: "published",
    });
    const underscore = await get("/notes?search=a_b");
    expect(underscore.json().items.map((i: { title: string }) => i.title)).toEqual(["a_b 下划线"]);
  });

  it("笔记详情相关的公开列表仍遵守可见性（转义不能把草稿项目捞进来）", async () => {
    const draftProject = await createProject(app, token, { name: "草稿项目" });
    await createNote(app, token, {
      project_id: draftProject.id,
      title: "含 % 的草稿笔记",
      body_md: "正文",
      publish_status: "published",
    });

    const res = await get("/notes?search=%25");
    expect(res.json().items).toEqual([]);
  });
});

describe("NoteSummary.excerpt（列表 / 详情 / 后台三路径都带）", () => {
  const longBody = `${"字".repeat(200)}`;

  it("公开列表：去 Markdown 后的前 120 字 + 省略号", async () => {
    const project = await createProject(app, token, { name: "所属项目", publish_status: "published" });
    await createNote(app, token, {
      project_id: project.id,
      title: "长正文",
      body_md: `# 标题\n\n${longBody}`,
      publish_status: "published",
    });

    const list = await get("/notes");
    const excerpt = list.json().items[0].excerpt as string;
    expect(excerpt).toHaveLength(121); // 120 字 + 省略号
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("#"); // Markdown 标记不残留
  });

  it("公开详情：同一份摘要，不是只有列表才有", async () => {
    const project = await createProject(app, token, { name: "所属项目", publish_status: "published" });
    const note = await createNote(app, token, {
      project_id: project.id,
      title: "详情摘要",
      body_md: "一段**带强调**的正文，还有 [链接](https://example.com)。",
      publish_status: "published",
    });

    const detail = await get(`/notes/${note.slug}`);
    expect(detail.json().excerpt).toBe("一段带强调的正文，还有 链接。");
  });

  it("后台列表与详情：同样带 excerpt（三条路径共用 serializer）", async () => {
    const project = await createProject(app, token, { name: "所属项目" });
    const note = await createNote(app, token, {
      project_id: project.id,
      title: "后台草稿",
      body_md: "草稿正文",
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/notes", headers: auth(token) });
    expect(list.json().items[0].excerpt).toBe("草稿正文");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes/${note.id}`,
      headers: auth(token),
    });
    expect(detail.json().excerpt).toBe("草稿正文");

    // 项目详情里的相关笔记也走同一个 serializer
    const projectDetail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/projects/${project.id}`,
      headers: auth(token),
    });
    expect(projectDetail.json().notes[0].excerpt).toBe("草稿正文");
  });

  it("空正文与纯 Markdown 标记 → null（不是空字符串）", async () => {
    const project = await createProject(app, token, { name: "所属项目" });
    const note = await createNote(app, token, {
      project_id: project.id,
      title: "只有标记",
      body_md: "   ",
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes/${note.id}`,
      headers: auth(token),
    });
    expect(detail.json().excerpt).toBeNull();
  });

  it("短正文原样保留（不加省略号）", async () => {
    const project = await createProject(app, token, { name: "所属项目", publish_status: "published" });
    const note = await createNote(app, token, {
      project_id: project.id,
      title: "短",
      body_md: "很短",
      publish_status: "published",
    });
    const detail = await get(`/notes/${note.slug}`);
    expect(detail.json().excerpt).toBe("很短");
  });
});
