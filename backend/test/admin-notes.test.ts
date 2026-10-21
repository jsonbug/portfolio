// 后台笔记接口：N:1 归属、slug 唯一、发布/撤回、标签整体替换、删除
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
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

async function project(name = "所属项目") {
  return createProject(app, token, { name, publish_status: "published" });
}

const patchNote = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/v1/admin/notes/${id}`, headers: auth(token), payload });

describe("POST /api/v1/admin/notes", () => {
  it("一个项目可挂多篇笔记（N:1），默认 draft 且 published_at 为空", async () => {
    const p = await project();
    const a = await createNote(app, token, { project_id: p.id, title: "笔记一" });
    const b = await createNote(app, token, { project_id: p.id, title: "笔记二" });

    expect(a.publish_status).toBe("draft");
    expect(a.published_at).toBeNull();
    expect(a.project_id).toBe(p.id);
    expect(a.id).not.toBe(b.id);
    expect(await prisma.note.count({ where: { project_id: p.id } })).toBe(2);
  });

  it("所属项目不存在 → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notes",
      headers: auth(token),
      payload: { project_id: "no-such-project", slug: "note-x", title: "t", body_md: "b" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("笔记 slug 冲突 → 409；不同项目间同名 slug 也冲突（note 命名空间全局唯一）", async () => {
    const p1 = await project("项目1");
    const p2 = await project("项目2");
    await createNote(app, token, { project_id: p1.id, slug: "dup-note" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notes",
      headers: auth(token),
      payload: { project_id: p2.id, slug: "dup-note", title: "t", body_md: "b" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("项目 slug 与笔记 slug 可以同名（slug_aliases 唯一键为 entity_type+slug）", async () => {
    const p = await project("同名项目");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/projects/${p.id}`,
      headers: auth(token),
      payload: { slug: "shared-name" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notes",
      headers: auth(token),
      payload: { project_id: p.id, slug: "shared-name", title: "t", body_md: "b" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("PATCH /api/v1/admin/notes/:id", () => {
  it("发布时写 published_at，撤回时清空", async () => {
    const p = await project();
    const note = await createNote(app, token, { project_id: p.id });

    const published = await patchNote(note.id, { publish_status: "published" });
    expect(published.statusCode).toBe(200);
    expect(published.json().publish_status).toBe("published");
    expect(published.json().published_at).toMatch(/^\d{4}-/);

    const withdrawn = await patchNote(note.id, { publish_status: "draft" });
    expect(withdrawn.json().publish_status).toBe("draft");
    expect(withdrawn.json().published_at).toBeNull();
  });

  it("tags 传数组即整体替换（含 [] 清空）并去重", async () => {
    const p = await project();
    const note = await createNote(app, token, { project_id: p.id, tags: ["A", "B"] });

    const replaced = await patchNote(note.id, { tags: ["C", "C", "D"] });
    expect(replaced.json().tags).toEqual(["C", "D"]);

    const cleared = await patchNote(note.id, { tags: [] });
    expect(cleared.json().tags).toEqual([]);
  });

  it("发布过的笔记改名：旧 slug 301；草稿改名不留别名", async () => {
    const p = await project();
    const published = await createNote(app, token, { project_id: p.id, slug: "note-pub-old", publish_status: "published" });
    await patchNote(published.id, { slug: "note-pub-new" });

    const res = await app.inject({ method: "GET", url: "/api/v1/notes/note-pub-old" });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe("/api/v1/notes/note-pub-new");

    const draft = await createNote(app, token, { project_id: p.id, slug: "note-draft-old" });
    await patchNote(draft.id, { slug: "note-draft-new" });
    const aliases = await prisma.slugAlias.findMany({ where: { entity_type: "note", slug: "note-draft-old" } });
    expect(aliases).toHaveLength(0);
  });

  it("改名为已占用 slug → 409", async () => {
    const p = await project();
    await createNote(app, token, { project_id: p.id, slug: "note-taken" });
    const note = await createNote(app, token, { project_id: p.id, slug: "note-free" });

    const res = await patchNote(note.id, { slug: "note-taken" });
    expect(res.statusCode).toBe(409);
  });

  it("笔记标题/正文可更新，未传字段不变", async () => {
    const p = await project();
    const note = await createNote(app, token, { project_id: p.id, title: "原标题", body_md: "原正文" });
    const res = await patchNote(note.id, { title: "新标题" });
    expect(res.json().title).toBe("新标题");
    expect(res.json().body_md).toBe("原正文");
  });

  it("不存在 → 404", async () => {
    const res = await patchNote("nope", { title: "x" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/admin/notes 与 DELETE", () => {
  it("列表可按 project_id / publish_status / search 过滤", async () => {
    const p1 = await project("项目1");
    const p2 = await project("项目2");
    await createNote(app, token, { project_id: p1.id, title: "Alpha 笔记", publish_status: "published" });
    await createNote(app, token, { project_id: p2.id, title: "Beta 笔记" });

    const byProject = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes?project_id=${p1.id}`,
      headers: auth(token),
    });
    expect(byProject.json().total).toBe(1);

    const byStatus = await app.inject({
      method: "GET",
      url: "/api/v1/admin/notes?publish_status=published",
      headers: auth(token),
    });
    expect(byStatus.json().items.map((i: { title: string }) => i.title)).toEqual(["Alpha 笔记"]);

    const bySearch = await app.inject({
      method: "GET",
      url: "/api/v1/admin/notes?search=Beta",
      headers: auth(token),
    });
    expect(bySearch.json().total).toBe(1);
  });

  it("search 按字面量匹配：_ 与 % 不当通配符（草稿也能搜到）", async () => {
    const p = await project();
    await createNote(app, token, { project_id: p.id, title: "v1_2 升级说明" });
    await createNote(app, token, { project_id: p.id, title: "发布进度 80%" });
    await createNote(app, token, { project_id: p.id, title: "普通笔记" });

    const underscore = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes?search=${encodeURIComponent("v1_2")}`,
      headers: auth(token),
    });
    expect(underscore.json().total).toBe(1);
    expect(underscore.json().items.map((i: { title: string }) => i.title)).toEqual(["v1_2 升级说明"]);

    // `%` 不转义时三篇全命中
    const percent = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes?search=${encodeURIComponent("%")}`,
      headers: auth(token),
    });
    expect(percent.json().total).toBe(1);
    expect(percent.json().items.map((i: { title: string }) => i.title)).toEqual(["发布进度 80%"]);

    // 正文也走同一转义路径
    const p2 = await project("项目3");
    await createNote(app, token, { project_id: p2.id, title: "正文命中", body_md: "折扣 50% 起" });
    const byBody = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notes?search=${encodeURIComponent("50%")}`,
      headers: auth(token),
    });
    expect(byBody.json().total).toBe(1);
    expect(byBody.json().items.map((i: { title: string }) => i.title)).toEqual(["正文命中"]);
  });

  it("详情返回 body_md；列表项不含 body_md", async () => {
    const p = await project();
    const note = await createNote(app, token, { project_id: p.id, body_md: "## 正文" });

    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/notes/${note.id}`, headers: auth(token) });
    expect(detail.json().body_md).toBe("## 正文");

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/notes", headers: auth(token) });
    expect("body_md" in (list.json().items as Array<Record<string, unknown>>)[0]).toBe(false);
  });

  it("删除后 404，标签级联删除", async () => {
    const p = await project();
    const note = await createNote(app, token, { project_id: p.id, tags: ["X"] });

    const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/notes/${note.id}`, headers: auth(token) });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({ method: "DELETE", url: `/api/v1/admin/notes/${note.id}`, headers: auth(token) });
    expect(again.statusCode).toBe(404);

    expect(await prisma.noteTag.count({ where: { note_id: note.id } })).toBe(0);
  });

  it("删除项目时笔记随之级联删除", async () => {
    const p = await project();
    await createNote(app, token, { project_id: p.id });
    await prisma.project.delete({ where: { id: p.id } });
    expect(await prisma.note.count({ where: { project_id: p.id } })).toBe(0);
  });
});
