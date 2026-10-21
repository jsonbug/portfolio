import { describe, expect, it } from "vitest";
import {
  AdminProjectListQuerySchema,
  ErrorEnvelopeSchema,
  LinkCreateSchema,
  LinkTypeSchema,
  NoteUpsertSchema,
  ProjectCreateSchema,
  ProjectStatusSchema,
  PublicProjectListQuerySchema,
} from "../src/contract/schemas.js";

describe("契约：ProjectCreateSchema", () => {
  it("最小合法 payload 通过", () => {
    expect(ProjectCreateSchema.safeParse({ name: "multica-demo" }).success).toBe(true);
  });

  it("缺失必填 name 失败", () => {
    expect(ProjectCreateSchema.safeParse({}).success).toBe(false);
  });

  it("非法 status 枚举被拒绝", () => {
    expect(ProjectStatusSchema.safeParse("public").success).toBe(false);
    expect(ProjectStatusSchema.safeParse("published").success).toBe(true);
  });

  it("coverImage：http/https 通过，null 通过，其他协议/非法值拒绝", () => {
    expect(
      ProjectCreateSchema.safeParse({ name: "x", coverImage: "https://e.com/c.webp" }).success,
    ).toBe(true);
    expect(ProjectCreateSchema.safeParse({ name: "x", coverImage: null }).success).toBe(true);
    expect(
      ProjectCreateSchema.safeParse({ name: "x", coverImage: "ftp://e.com/c.webp" }).success,
    ).toBe(false);
    expect(ProjectCreateSchema.safeParse({ name: "x", coverImage: "not-a-url" }).success).toBe(
      false,
    );
  });
});

describe("契约：LinkCreateSchema", () => {
  it("非法 URL 被拒绝", () => {
    expect(LinkCreateSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("合法 URL + 默认 type=other", () => {
    const r = LinkCreateSchema.safeParse({ url: "https://github.com/jsonbug" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("other");
  });

  it("url 仅接受 http/https 协议（ftp/mailto/javascript 拒绝）", () => {
    expect(LinkCreateSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(LinkCreateSchema.safeParse({ url: "http://example.com" }).success).toBe(true);
    expect(LinkCreateSchema.safeParse({ url: "ftp://example.com" }).success).toBe(false);
    expect(LinkCreateSchema.safeParse({ url: "mailto:a@b.com" }).success).toBe(false);
    expect(LinkCreateSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("LinkType 枚举冻结为 4 个值", () => {
    expect(LinkTypeSchema.safeParse("repo").success).toBe(true);
    expect(LinkTypeSchema.safeParse("social").success).toBe(false);
  });
});

describe("契约：NoteUpsertSchema", () => {
  it("空标题失败", () => {
    expect(NoteUpsertSchema.safeParse({ title: "", content: "x" }).success).toBe(false);
  });

  it("合法笔记通过", () => {
    expect(NoteUpsertSchema.safeParse({ title: "笔记", content: "# 标题" }).success).toBe(
      true,
    );
  });
});

describe("契约：列表查询 schema", () => {
  it("后台列表含 status/search/includeDeleted", () => {
    const r = AdminProjectListQuerySchema.safeParse({ includeDeleted: "true" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.includeDeleted).toBe(true);
  });

  it("前台列表含 search/technology（契约先行冻结）", () => {
    const r = PublicProjectListQuerySchema.safeParse({ technology: "Vue", page: 2 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.technology).toBe("Vue");
      expect(r.data.page).toBe(2);
    }
  });
});

describe("契约：错误信封", () => {
  it("标准错误结构", () => {
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: { code: "NOT_FOUND", message: "资源不存在" },
      }).success,
    ).toBe(true);
  });
});
