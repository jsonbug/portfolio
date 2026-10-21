// 冻结的 API 契约（可执行形态）：请求/响应结构 + 字段校验规则。
// 与 docs/api-contract.md 保持同步；任何改动都视为契约变更，需在 issue 中说明。
import { z } from "zod";

// ---------- 枚举（冻结值） ----------
// status 状态机（冻结）：draft→published、published→archived、archived→published；
// 其余（跨级 draft↔archived、published→draft）返回 400 INVALID_STATUS_TRANSITION；相同状态 no-op。
export const ProjectStatusSchema = z.enum(["draft", "published", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const LinkTypeSchema = z.enum(["repo", "website", "demo", "other"]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const ProjectLifecycleSchema = z.enum([
  "active",
  "completed",
  "maintained",
  "paused",
]);
export type ProjectLifecycle = z.infer<typeof ProjectLifecycleSchema>;

// ---------- 通用 ----------
export const isoDatetime = () =>
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "必须是 ISO-8601 时间" });

export const TechnologyNameSchema = z.string().trim().min(1).max(50);

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const listEnvelopeSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });

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

// 项目封面图 url：http/https ≤2048（可选，null=渐层兜底）
export const coverImageSchema = httpUrl("封面图片必须是 http/https 地址");

export const LinkSchema = z.object({
  id: z.string(),
  type: LinkTypeSchema,
  label: z.string().nullable(),
  url: z.string(),
  sortOrder: z.number().int(),
  createdAt: isoDatetime(),
});
export type Link = z.infer<typeof LinkSchema>;

export const LinkCreateSchema = z.object({
  type: LinkTypeSchema.default("other"),
  label: z.string().trim().max(100).nullable().optional(),
  url: httpUrlSchema,
  sortOrder: z.number().int().min(0).optional(),
});
export type LinkCreate = z.infer<typeof LinkCreateSchema>;

export const LinkUpdateSchema = z.object({
  type: LinkTypeSchema.optional(),
  label: z.string().trim().max(100).nullable().optional(),
  url: httpUrlSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type LinkUpdate = z.infer<typeof LinkUpdateSchema>;

// ---------- 笔记（1:1 项目） ----------
export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: isoDatetime(),
  updatedAt: isoDatetime(),
});
export type Note = z.infer<typeof NoteSchema>;

export const NoteUpsertSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(100_000),
});
export type NoteUpsert = z.infer<typeof NoteUpsertSchema>;

// ---------- 项目 ----------
export const ProjectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  coverImage: z.string().nullable(),
  status: ProjectStatusSchema,
  stars: z.number().int().nullable(),
  lastActivityAt: isoDatetime().nullable(),
  technologies: z.array(z.string()),
  createdAt: isoDatetime(),
  updatedAt: isoDatetime(),
});
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const ProjectDetailSchema = ProjectListItemSchema.extend({
  description: z.string().nullable(),
  role: z.string().nullable(),
  projectStatus: ProjectLifecycleSchema.nullable(),
  startDate: isoDatetime().nullable(),
  endDate: isoDatetime().nullable(),
  githubRepo: z.string().nullable(),
  links: z.array(LinkSchema),
  note: NoteSchema.nullable(),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tagline: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(100_000).nullable().optional(),
  coverImage: coverImageSchema.nullable().optional(),
  status: ProjectStatusSchema.optional(),
  stars: z.number().int().min(0).nullable().optional(),
  lastActivityAt: isoDatetime().nullable().optional(),
  role: z.string().trim().max(100).nullable().optional(),
  projectStatus: ProjectLifecycleSchema.nullable().optional(),
  startDate: isoDatetime().nullable().optional(),
  endDate: isoDatetime().nullable().optional(),
  githubRepo: z.string().trim().max(200).nullable().optional(),
  technologies: z.array(TechnologyNameSchema).max(50).optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

// PATCH 语义（契约冻结）：未传字段忽略；显式 null 清空 nullable 字段；technologies 传数组即整体替换（含 [] 清空）。
export const ProjectUpdateSchema = ProjectCreateSchema.partial();
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

// ---------- 后台管理响应（含软删除状态） ----------
export const AdminProjectListItemSchema = ProjectListItemSchema.extend({
  deletedAt: isoDatetime().nullable(),
});
export type AdminProjectListItem = z.infer<typeof AdminProjectListItemSchema>;

export const AdminProjectDetailSchema = ProjectDetailSchema.extend({
  deletedAt: isoDatetime().nullable(),
});
export type AdminProjectDetail = z.infer<typeof AdminProjectDetailSchema>;

// ---------- 后台列表查询 ----------
// Fastify query 为字符串；布尔参数兼容 true/false/1/0/空（空=默认）
export const boolQuery = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return defaultValue;
    if (typeof v === "boolean") return v;
    return v === "true" || v === "1";
  }, z.boolean());

export const AdminProjectListQuerySchema = PageQuerySchema.extend({
  status: ProjectStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  includeDeleted: boolQuery(false),
});
export type AdminProjectListQuery = z.infer<typeof AdminProjectListQuerySchema>;

// 前台公开列表查询（阶段 3 实现路由；契约先行冻结参数名与校验）
export const PublicProjectListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  technology: TechnologyNameSchema.optional(),
});
export type PublicProjectListQuery = z.infer<typeof PublicProjectListQuerySchema>;

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
