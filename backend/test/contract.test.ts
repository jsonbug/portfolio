// 契约可执行形态自检：枚举取值、slug 规则、校验边界、查询参数解析
import { describe, expect, it } from "vitest";
import {
  AdminProjectListQuerySchema,
  LinkCreateSchema,
  MetadataReplaceSchema,
  NoteCreateSchema,
  ProjectCreateSchema,
  PublicProjectListQuerySchema,
  PublishStatusSchema,
  ProgressSchema,
  SlugSchema,
  LinkTypeSchema,
} from "../src/contract/schemas.js";
import { SLUG_PATTERN } from "../src/lib/slug.js";

describe("枚举冻结值", () => {
  it("publish_status 三值 / progress 两值（归档不是进展分段）", () => {
    expect(PublishStatusSchema.options).toEqual(["draft", "published", "archived"]);
    expect(ProgressSchema.options).toEqual(["ongoing", "launched"]);
    expect(() => ProgressSchema.parse("archived")).toThrow();
  });

  it("链接类型 v1.2 枚举含 site、不含 website", () => {
    expect(LinkTypeSchema.options).toEqual(["repo", "site", "docs", "demo", "other"]);
    expect(() => LinkTypeSchema.parse("website")).toThrow();
  });
});

describe("slug 规则 ^[a-z0-9-]{2,64}$", () => {
  it("接受小写字母/数字/连字符", () => {
    for (const ok of ["ab", "my-project", "p-123", "a1-b2"]) {
      expect(SlugSchema.parse(ok)).toBe(ok);
      expect(SLUG_PATTERN.test(ok)).toBe(true);
    }
  });

  it("拒绝大写、下划线、空格、中文、单字符、超长", () => {
    for (const bad of ["Ab", "a_b", "a b", "项目", "a", "x".repeat(65)]) {
      expect(() => SlugSchema.parse(bad)).toThrow();
      expect(SLUG_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("项目创建校验", () => {
  it("summary 上限 60 字", () => {
    const base = { slug: "p-1", name: "项目" };
    expect(ProjectCreateSchema.parse({ ...base, summary: "字".repeat(60) }).summary).toHaveLength(60);
    expect(() => ProjectCreateSchema.parse({ ...base, summary: "字".repeat(61) })).toThrow();
  });

  it("start_year / team_size 边界", () => {
    expect(ProjectCreateSchema.parse({ slug: "p-1", name: "x", start_year: 1000 }).start_year).toBe(1000);
    expect(ProjectCreateSchema.parse({ slug: "p-1", name: "x", start_year: 9999 }).start_year).toBe(9999);
    expect(() => ProjectCreateSchema.parse({ slug: "p-1", name: "x", start_year: 999 })).toThrow();
    expect(() => ProjectCreateSchema.parse({ slug: "p-1", name: "x", team_size: 0 })).toThrow();
    expect(ProjectCreateSchema.parse({ slug: "p-1", name: "x", team_size: null }).team_size).toBeNull();
  });

  it("封面 url 必须是 http/https", () => {
    expect(() =>
      ProjectCreateSchema.parse({ slug: "p-1", name: "x", cover_image_url: "data:image/png;base64,xx" }),
    ).toThrow();
    expect(
      ProjectCreateSchema.parse({ slug: "p-1", name: "x", cover_image_url: "https://e.com/a.webp" }).cover_image_url,
    ).toBe("https://e.com/a.webp");
  });
});

describe("元数据整体替换校验", () => {
  it("键名去重；上限 50 条", () => {
    expect(() =>
      MetadataReplaceSchema.parse([
        { key_label: "A", value: "1" },
        { key_label: "A", value: "2" },
      ]),
    ).toThrow();

    const fifty = Array.from({ length: 50 }, (_, i) => ({ key_label: `K${i}`, value: "v" }));
    expect(MetadataReplaceSchema.parse(fifty)).toHaveLength(50);
    expect(() => MetadataReplaceSchema.parse([...fifty, { key_label: "K50", value: "v" }])).toThrow();
  });

  it("键名/值非空", () => {
    expect(() => MetadataReplaceSchema.parse([{ key_label: "", value: "v" }])).toThrow();
    expect(() => MetadataReplaceSchema.parse([{ key_label: "K", value: "" }])).toThrow();
  });
});

describe("笔记创建校验", () => {
  it("必须有 project_id；正文非空；标签上限 20", () => {
    const base = { slug: "n-1", title: "标题", body_md: "正文" };
    expect(() => NoteCreateSchema.parse(base)).toThrow();
    expect(() => NoteCreateSchema.parse({ ...base, project_id: "p", body_md: "" })).toThrow();
    expect(
      NoteCreateSchema.parse({
        ...base,
        project_id: "p",
        tags: Array.from({ length: 20 }, (_, i) => `t${i}`),
      }).tags,
    ).toHaveLength(20);
  });
});

describe("查询参数解析", () => {
  it("公开列表：progress 只接受两值，sort 默认 recent", () => {
    expect(PublicProjectListQuerySchema.parse({}).sort).toBe("recent");
    expect(PublicProjectListQuerySchema.parse({ progress: "launched" }).progress).toBe("launched");
    expect(() => PublicProjectListQuerySchema.parse({ progress: "archived" })).toThrow();
    expect(() => PublicProjectListQuerySchema.parse({ sort: "newest" })).toThrow();
  });

  it("technology 支持重复参数与逗号分隔", () => {
    expect(PublicProjectListQuerySchema.parse({ technology: "Vue,Node.js" }).technology).toEqual(["Vue", "Node.js"]);
    expect(PublicProjectListQuerySchema.parse({ technology: ["Vue", "React"] }).technology).toEqual(["Vue", "React"]);
    expect(PublicProjectListQuerySchema.parse({ technology: "" }).technology).toBeUndefined();
  });

  it("includeDeleted 兼容 true/1/空", () => {
    expect(AdminProjectListQuerySchema.parse({}).includeDeleted).toBe(false);
    expect(AdminProjectListQuerySchema.parse({ includeDeleted: "true" }).includeDeleted).toBe(true);
    expect(AdminProjectListQuerySchema.parse({ includeDeleted: "1" }).includeDeleted).toBe(true);
    expect(AdminProjectListQuerySchema.parse({ includeDeleted: "false" }).includeDeleted).toBe(false);
  });

  it("链接创建：type 默认 other", () => {
    expect(LinkCreateSchema.parse({ url: "https://e.com" }).type).toBe("other");
  });
});
