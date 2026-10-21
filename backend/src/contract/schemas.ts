// 冻结的 API 契约（可执行形态）：请求/响应结构 + 字段校验规则。
// 与 docs/api-contract.md 保持同步；任何改动都视为契约变更，需在 issue 中说明。
//
// v1.2（ALICE-7 阶段 1）：字段命名统一为《开发计划 v1.2》第五节的 snake_case，
// 状态拆 publish_status（曝光）+ progress（进展）两字段，项目/笔记以 slug 定位。
import { z } from "zod";

// ---------- 枚举（冻结值） ----------
// 曝光维度状态机（v1.2）：draft→published、published→archived / published→draft（撤回）、
// archived→published；其余（跨级 draft↔archived）返回 400 INVALID_STATUS_TRANSITION；相同状态 no-op。
export const PublishStatusSchema = z.enum(["draft", "published", "archived"]);
export type PublishStatus = z.infer<typeof PublishStatusSchema>;

// 内容维度进展（与曝光维度正交，不参与可见性判断）
export const ProgressSchema = z.enum(["ongoing", "launched"]);
export type Progress = z.infer<typeof ProgressSchema>;

export const LinkTypeSchema = z.enum(["repo", "site", "docs", "demo", "other"]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const LinkStatusSchema = z.enum(["ok", "failed", "unknown"]);
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

export const NotePublishStatusSchema = z.enum(["draft", "published"]);
export type NotePublishStatus = z.infer<typeof NotePublishStatusSchema>;

export const EntityTypeSchema = z.enum(["project", "note"]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

// ---------- 通用 ----------
export const isoDatetime = () =>
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "必须是 ISO-8601 时间" });

// slug：全站唯一、^[a-z0-9-]{2,64}$（B15）
export const SlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{2,64}$/, "slug 只能包含小写字母、数字与连字符，长度 2–64");

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// 技术栈名（项目内多值）
export const TechNameSchema = z.string().trim().min(1).max(50);

// ---------- 链接 ----------
// 链接 url：仅 http/https（架构师评审第 10 条：z.string().url() 会接受 ftp/mailto 等，改 refine 收紧）
const httpUrl = (message: string) =>
  z
    .string()
    .max(2048)
    .refine((v) => {
      try {
        const p = new URL(v).protocol;
        return p === "http:" || p === "https:";
      } catch {
        return false;
      }
    }, message);

const httpUrlSchema = httpUrl("链接必须是 http/https 地址");
const coverUrlSchema = httpUrl("封面图片必须是 http/https 地址");

export const LinkSchema = z.object({
  id: z.string(),
  type: LinkTypeSchema,
  label: z.string().nullable(),
  url: z.string(),
  sort: z.number().int(),
  last_status: LinkStatusSchema,
  last_http_status: z.number().int().nullable(),
  last_checked_at: isoDatetime().nullable(),
  created_at: isoDatetime(),
});
export type Link = z.infer<typeof LinkSchema>;

export const LinkCreateSchema = z.object({
  type: LinkTypeSchema.default("other"),
  label: z.string().trim().max(100).nullable().optional(),
  url: httpUrlSchema,
  sort: z.number().int().min(0).optional(),
});
export type LinkCreate = z.infer<typeof LinkCreateSchema>;

export const LinkUpdateSchema = z.object({
  type: LinkTypeSchema.optional(),
  label: z.string().trim().max(100).nullable().optional(),
  url: httpUrlSchema.optional(),
  sort: z.number().int().min(0).optional(),
});
export type LinkUpdate = z.infer<typeof LinkUpdateSchema>;

// ---------- 元数据 KV ----------
//
// kind：meta = 元数据 panel 的普通条目；metric = 详情页指标卡的格子（≤2 条，键值更短）。
// 缺省 meta——旧请求体不带 kind 也照样通过，不做破坏性变更。
export const METADATA_KINDS = ["meta", "metric"] as const;
export const MetadataKindSchema = z.enum(METADATA_KINDS);
export type MetadataKind = z.infer<typeof MetadataKindSchema>;

/** metric 型条目的额外约束（要放进指标卡格子：标签 ≤16 字、数值 ≤12 字、最多 2 条） */
export const METRIC_LIMITS = { max: 2, keyLabel: 16, value: 12 } as const;

export const MetadataItemSchema = z.object({
  key_label: z.string().trim().min(1).max(50),
  value: z.string().trim().min(1).max(500),
  kind: MetadataKindSchema.optional(),
  sort: z.number().int().min(0).optional(),
});
export type MetadataItem = z.infer<typeof MetadataItemSchema>;

// 同一项目内键名不可重复（B6）→ 应用层先给 400，而不是撞库得 409；
// metric ≤2 条、metric 条目 key_label ≤16 / value ≤12。
export const MetadataReplaceSchema = z
  .array(MetadataItemSchema)
  .max(50)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.key_label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key_label"],
          message: "同一项目内元数据键名不可重复",
        });
      }
      seen.add(item.key_label);
    });

    const metrics = items.filter((item) => item.kind === "metric");
    if (metrics.length > METRIC_LIMITS.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `指标卡条目最多 ${METRIC_LIMITS.max} 条（当前 ${metrics.length}）`,
      });
    }
    items.forEach((item, index) => {
      if (item.kind !== "metric") return;
      if (item.key_label.length > METRIC_LIMITS.keyLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key_label"],
          message: `指标卡标签最多 ${METRIC_LIMITS.keyLabel} 字（当前 ${item.key_label.length}）`,
        });
      }
      if (item.value.length > METRIC_LIMITS.value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "value"],
          message: `指标卡数值最多 ${METRIC_LIMITS.value} 字（当前 ${item.value.length}）`,
        });
      }
    });
  });
export type MetadataReplace = z.infer<typeof MetadataReplaceSchema>;

export const MetadataResponseSchema = z.object({
  key_label: z.string(),
  value: z.string(),
  kind: MetadataKindSchema,
  sort: z.number().int(),
});
export type MetadataResponse = z.infer<typeof MetadataResponseSchema>;

// ---------- 项目截图（F2 截图轮播） ----------
//
// 只存原图 URL（派生尺寸交前端 object-fit，后端不做第二套图片管线）；
// 整体替换语义同 /metadata，顺序即 sort；每项目 ≤10 张；caption 可空 ≤80 字。
// 截图 URL：必须是能真加载的 http(s) 绝对地址。
// 原来只做 /^https?:\/\// 前缀测试，于是 `https://`（无主机）与 `http://e.com/a b.png`（空白）
// 都能入库，后台回「保存成功」、前台是空白格——正常误用下的**静默失败**，定 P1。
// 三条拒绝：空白字符、`new URL()` 解不开（含 `//e.com/a.png` 这类协议相对 URL）、
// 协议不是 http(s) 或 host 为空（`https://` 走 URL 构造失败，`https:///x` 走 host 空检查）。
const screenshotUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (/\s/.test(v)) return fail("地址里不能有空白字符");
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      return fail("必须是合法的 http(s) 绝对地址（例如 https://cdn.example.com/shot.png）");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("必须是 http(s) 地址");
    if (!parsed.hostname) return fail("地址缺少主机名");
  });

export const SCREENSHOT_MAX = 10;
export const SCREENSHOT_CAPTION_MAX = 80;

export const ScreenshotItemSchema = z.object({
  url: screenshotUrlSchema,
  caption: z.string().trim().max(SCREENSHOT_CAPTION_MAX).nullable().optional(),
  sort: z.number().int().min(0).optional(),
});
export type ScreenshotItem = z.infer<typeof ScreenshotItemSchema>;

export const ScreenshotsReplaceSchema = z
  .array(ScreenshotItemSchema)
  .max(SCREENSHOT_MAX, { message: `每个项目最多 ${SCREENSHOT_MAX} 张截图` });
export type ScreenshotsReplace = z.infer<typeof ScreenshotsReplaceSchema>;

export const ScreenshotSchema = z.object({
  id: z.string(),
  url: z.string(),
  caption: z.string().nullable(),
  sort: z.number().int(),
});
export type Screenshot = z.infer<typeof ScreenshotSchema>;

// ---------- 笔记（N:1 项目） ----------
export const NoteSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  project: z.object({ slug: z.string(), name: z.string() }),
  // 去 Markdown 后的前 120 字（超长加省略号，空正文 null）：列表 / 详情 / 后台三条路径共用，
  // 详情不开口子，否则前端要为「有摘要」「没摘要」写两套渲染分支（契约 v1.2.3 §3.3）
  excerpt: z.string().max(121).nullable(),
  tags: z.array(z.string()),
  published_at: isoDatetime().nullable(),
  created_at: isoDatetime(),
  updated_at: isoDatetime(),
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const NoteDetailSchema = NoteSummarySchema.extend({
  body_md: z.string(),
});
export type NoteDetail = z.infer<typeof NoteDetailSchema>;

export const NoteCreateSchema = z.object({
  project_id: z.string().min(1),
  slug: SlugSchema,
  title: z.string().trim().min(1).max(200),
  body_md: z.string().min(1).max(100_000),
  publish_status: NotePublishStatusSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});
export type NoteCreate = z.infer<typeof NoteCreateSchema>;

// PATCH 语义：未传字段忽略；tags 传数组即整体替换（含 [] 清空）；publish_status 变更时维护 published_at
export const NoteUpdateSchema = NoteCreateSchema.omit({ project_id: true }).partial();
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>;

export const AdminNoteListItemSchema = NoteSummarySchema.extend({
  publish_status: NotePublishStatusSchema,
  project_id: z.string(),
});
export type AdminNoteListItem = z.infer<typeof AdminNoteListItemSchema>;

// 后台详情额外带正文（编辑器回填）
export const AdminNoteDetailSchema = AdminNoteListItemSchema.extend({
  body_md: z.string(),
});
export type AdminNoteDetail = z.infer<typeof AdminNoteDetailSchema>;

// 项目详情的笔记列表（后台）额外带发布状态：编辑器要在项目内区分草稿/已发布
// （前台详情 same 位置只出已发布笔记，见 ProjectDetailSchema）
export const AdminNoteSummarySchema = NoteSummarySchema.extend({
  publish_status: NotePublishStatusSchema,
});
export type AdminNoteSummary = z.infer<typeof AdminNoteSummarySchema>;

// ---------- 项目 ----------
export const ProjectListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  progress: ProgressSchema,
  stars: z.number().int().nullable(),
  version: z.string().nullable(),
  last_updated_at: isoDatetime().nullable(),
  tech_stack: z.array(z.string()),
  links: z.array(LinkSchema),
  created_at: isoDatetime(),
  updated_at: isoDatetime(),
});
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const ProjectDetailSchema = ProjectListItemSchema.extend({
  description_md: z.string().nullable(),
  role: z.string().nullable(),
  license: z.string().nullable(),
  start_year: z.number().int().nullable(),
  team_size: z.number().int().nullable(),
  metadata: z.array(MetadataResponseSchema),
  // 按 sort 升序；无截图为 []（前端整块不渲染）
  screenshots: z.array(ScreenshotSchema),
  notes: z.array(NoteSummarySchema),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectCreateSchema = z.object({
  slug: SlugSchema,
  name: z.string().trim().min(1).max(100),
  summary: z.string().trim().max(60).nullable().optional(),
  description_md: z.string().max(100_000).nullable().optional(),
  cover_image_url: coverUrlSchema.nullable().optional(),
  cover_source_url: coverUrlSchema.nullable().optional(),
  publish_status: PublishStatusSchema.optional(),
  progress: ProgressSchema.optional(),
  stars: z.number().int().min(0).nullable().optional(),
  version: z.string().trim().max(50).nullable().optional(),
  last_updated_at: isoDatetime().nullable().optional(),
  role: z.string().trim().max(100).nullable().optional(),
  license: z.string().trim().max(100).nullable().optional(),
  start_year: z.number().int().min(1000).max(9999).nullable().optional(),
  team_size: z.number().int().min(1).max(100_000).nullable().optional(),
  tech_stack: z.array(TechNameSchema).max(50).optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

// PATCH 语义（契约冻结）：未传字段忽略；显式 null 清空 nullable 字段；
// tech_stack 传数组即整体替换（含 [] 清空），顺序即 sort；metadata 见 PUT /admin/projects/:id/metadata。
export const ProjectUpdateSchema = ProjectCreateSchema.partial();
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

// ---------- 后台管理响应（含曝光状态与软删除） ----------
export const AdminProjectListItemSchema = ProjectListItemSchema.extend({
  publish_status: PublishStatusSchema,
  published_at: isoDatetime().nullable(),
  deleted_at: isoDatetime().nullable(),
});
export type AdminProjectListItem = z.infer<typeof AdminProjectListItemSchema>;

export const AdminProjectDetailSchema = ProjectDetailSchema.extend({
  publish_status: PublishStatusSchema,
  published_at: isoDatetime().nullable(),
  cover_source_url: z.string().nullable(),
  deleted_at: isoDatetime().nullable(),
  notes: z.array(AdminNoteSummarySchema),
});
export type AdminProjectDetail = z.infer<typeof AdminProjectDetailSchema>;

// 后台列表分段计数（B9：全部 / 已发布 / 草稿 / 已归档）
// 口径：search + includeDeleted 过滤后、publish_status 过滤前的集合；四项满足 all = 后三者之和
export const AdminProjectCountsSchema = z.object({
  all: z.number().int(),
  draft: z.number().int(),
  published: z.number().int(),
  archived: z.number().int(),
});
export type AdminProjectCounts = z.infer<typeof AdminProjectCountsSchema>;

// ---------- 列表查询 ----------
// Fastify query 为字符串；布尔参数兼容 true/false/1/0/空（空=默认）
export const boolQuery = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return defaultValue;
    if (typeof v === "boolean") return v;
    return v === "true" || v === "1";
  }, z.boolean());

// 重复参数（`?technology=Vue&technology=Node`）或逗号分隔（`?technology=Vue,Node`）都接受
const multiQuery = (item: z.ZodType<string>) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return undefined;
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const cleaned = arr.map((s) => String(s).trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }, z.array(item).max(20).optional());

export const AdminProjectListQuerySchema = PageQuerySchema.extend({
  publish_status: PublishStatusSchema.optional(),
  progress: ProgressSchema.optional(),
  search: z.string().trim().max(200).optional(),
  includeDeleted: boolQuery(false),
});
export type AdminProjectListQuery = z.infer<typeof AdminProjectListQuerySchema>;

// 前台公开列表查询（F1/F6）：progress 分段只有 ongoing / launched（归档前台不可见，无归档分段）
export const PublicProjectListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  technology: multiQuery(TechNameSchema),
  progress: ProgressSchema.optional(),
  sort: z.enum(["recent", "stars"]).default("recent"),
});
export type PublicProjectListQuery = z.infer<typeof PublicProjectListQuerySchema>;

export const AdminNoteListQuerySchema = PageQuerySchema.extend({
  publish_status: NotePublishStatusSchema.optional(),
  project_id: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});
export type AdminNoteListQuery = z.infer<typeof AdminNoteListQuerySchema>;

export const PublicNoteListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
});
export type PublicNoteListQuery = z.infer<typeof PublicNoteListQuerySchema>;

// ---------- 技术栈标签列表 ----------
export const TechnologyListSchema = z.object({
  items: z.array(z.string()),
});
export type TechnologyList = z.infer<typeof TechnologyListSchema>;

// ---------- 登录 ----------
export const LoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  expiresAt: isoDatetime(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ---------- 错误信封 ----------
export const ErrorDetailSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
});
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
