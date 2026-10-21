// Prisma 模型 → 契约响应形状（v1.2，字段名为第五节 snake_case）
import type { Prisma } from "@prisma/client";
import type {
  AdminNoteDetail,
  AdminNoteListItem,
  AdminProjectDetail,
  AdminProjectListItem,
  Link,
  NoteDetail,
  MetadataResponse,
  NoteSummary,
  ProjectDetail,
  ProjectListItem,
} from "../contract/schemas.js";
import type { Screenshot } from "../contract/schemas.js";

const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ---------- include 片段 ----------
const techAndLinks = {
  tech_stack: { orderBy: { sort: "asc" } },
  links: { orderBy: { sort: "asc" } },
} satisfies Prisma.ProjectInclude;

export const projectListInclude = techAndLinks satisfies Prisma.ProjectInclude;
// 后台列表：与公开列表同一组关联（不含 metadata/notes/screenshots，避免列表页 N+1 展开）
export const adminProjectListInclude = techAndLinks satisfies Prisma.ProjectInclude;

// 截图：只存原图 URL，派生尺寸交前端（F2）；按 sort 升序
const screenshotsInclude = { screenshots: { orderBy: { sort: "asc" } } } satisfies Prisma.ProjectInclude;

// 前台详情：只挂已发布笔记（N3/F2「相关笔记」）
export const publicProjectDetailInclude = {
  ...techAndLinks,
  ...screenshotsInclude,
  metadata: { orderBy: { sort: "asc" } },
  notes: {
    where: { publish_status: "published" },
    orderBy: [{ published_at: "desc" }, { created_at: "desc" }],
    include: { tags: { orderBy: { name: "asc" } } },
  },
} satisfies Prisma.ProjectInclude;

// 后台详情：所有笔记（含草稿）
export const adminProjectDetailInclude = {
  ...techAndLinks,
  ...screenshotsInclude,
  metadata: { orderBy: { sort: "asc" } },
  notes: {
    orderBy: { updated_at: "desc" },
    include: { tags: { orderBy: { name: "asc" } } },
  },
} satisfies Prisma.ProjectInclude;

export const noteInclude = {
  project: { select: { slug: true, name: true, publish_status: true, deleted_at: true } },
  tags: { orderBy: { name: "asc" } },
} satisfies Prisma.NoteInclude;

export type ProjectListRow = Prisma.ProjectGetPayload<{ include: typeof projectListInclude }>;
export type PublicProjectDetailRow = Prisma.ProjectGetPayload<{
  include: typeof publicProjectDetailInclude;
}>;
export type AdminProjectDetailRow = Prisma.ProjectGetPayload<{
  include: typeof adminProjectDetailInclude;
}>;
export type NoteRow = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

// ---------- 序列化 ----------
export function toLink(l: {
  id: string;
  type: string;
  url: string;
  label: string | null;
  sort: number;
  last_status: string | null;
  last_http_status: number | null;
  last_checked_at: Date | null;
  created_at: Date;
}): Link {
  return {
    id: l.id,
    type: l.type as Link["type"],
    url: l.url,
    label: l.label,
    sort: l.sort,
    // 库内 null = 从未检查，wire 上一律 "unknown"（前端不用做 null 分支）
    last_status: (l.last_status as Link["last_status"] | null) ?? "unknown",
    last_http_status: l.last_http_status,
    last_checked_at: toIso(l.last_checked_at),
    created_at: l.created_at.toISOString(),
  };
}

const EXCERPT_MAX = 120;

/**
 * 笔记摘要：正文去掉 Markdown 标记后的前 120 字，超长补省略号，空正文为 null。
 *
 * 三处调用（公开列表 / 公开详情 / 后台列表与详情）共用这一个函数——契约 v1.2.3 要求详情也必带，
 * 一旦给某条路径开口子，前端就得为「有摘要 / 没摘要」写两套渲染分支。
 */
export function excerptOf(bodyMd: string | null | undefined): string | null {
  if (!bodyMd) return null;
  const plain = bodyMd
    .replace(/```[\s\S]*?```/g, " ") // 代码块整段丢弃
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接保留文字
    .replace(/<[^>]+>/g, " ") // 内联 HTML
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题
    .replace(/^\s{0,3}>\s?/gm, "") // 引用
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "") // 列表序号
    .replace(/[*_~`]/g, "") // 强调 / 行内代码标记
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > EXCERPT_MAX ? `${plain.slice(0, EXCERPT_MAX)}…` : plain;
}

// 笔记摘要：project 由调用方显式传入（列表来自 note.project；项目详情里的笔记即父项目）
type NoteBase = {
  id: string;
  body_md: string;
  slug: string;
  title: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  tags: Array<{ name: string }>;
};

export function toNoteSummary(n: NoteBase, project: { slug: string; name: string }): NoteSummary {
  return {
    id: n.id,
    slug: n.slug,
    title: n.title,
    project: { slug: project.slug, name: project.name },
    excerpt: excerptOf(n.body_md),
    tags: n.tags.map((t) => t.name),
    published_at: toIso(n.published_at),
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  };
}

export function toPublicNoteDetail(n: NoteRow & { body_md: string }): NoteDetail {
  return { ...toNoteSummary(n, n.project), body_md: n.body_md };
}

export function toAdminNoteDetail(n: NoteRow & { body_md: string }): AdminNoteDetail {
  return { ...toAdminNoteListItem(n), body_md: n.body_md };
}

export function toAdminNoteListItem(n: NoteRow): AdminNoteListItem {
  return {
    ...toNoteSummary(n, n.project),
    publish_status: n.publish_status as AdminNoteListItem["publish_status"],
    project_id: n.project_id,
  };
}

// 列表项 / 详情共用字段（链接与元数据只在此展开一次）
function baseListItem(p: ProjectListRow): ProjectListItem {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    cover_image_url: p.cover_image_url,
    progress: p.progress as ProjectListItem["progress"],
    stars: p.stars,
    version: p.version,
    last_updated_at: toIso(p.last_updated_at),
    tech_stack: p.tech_stack.map((t) => t.name),
    links: p.links.map(toLink),
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  };
}

const metadataItems = (rows: Array<{ key_label: string; value: string; kind: string; sort: number }>) =>
  rows.map((m) => ({
    key_label: m.key_label,
    value: m.value,
    kind: m.kind as MetadataResponse["kind"],
    sort: m.sort,
  }));

export function toScreenshot(s: {
  id: string;
  url: string;
  caption: string | null;
  sort: number;
}): Screenshot {
  return { id: s.id, url: s.url, caption: s.caption, sort: s.sort };
}

// ---------- 前台公开（不含 publish_status / deleted_at） ----------
export function toPublicListItem(p: ProjectListRow): ProjectListItem {
  return baseListItem(p);
}

export function toPublicDetail(p: PublicProjectDetailRow): ProjectDetail {
  return {
    ...baseListItem(p),
    description_md: p.description_md,
    role: p.role,
    license: p.license,
    start_year: p.start_year,
    team_size: p.team_size,
    metadata: metadataItems(p.metadata),
    screenshots: p.screenshots.map(toScreenshot),
    notes: p.notes.map((n) => toNoteSummary(n, { slug: p.slug, name: p.name })),
  };
}

// ---------- 后台管理（额外含曝光状态、发布时间、软删除） ----------
export function toAdminListItem(p: ProjectListRow): AdminProjectListItem {
  return {
    ...baseListItem(p),
    publish_status: p.publish_status as AdminProjectListItem["publish_status"],
    published_at: toIso(p.published_at),
    deleted_at: toIso(p.deleted_at),
  };
}

export function toAdminDetail(p: AdminProjectDetailRow): AdminProjectDetail {
  return {
    ...baseListItem(p),
    publish_status: p.publish_status as AdminProjectDetail["publish_status"],
    published_at: toIso(p.published_at),
    deleted_at: toIso(p.deleted_at),
    cover_source_url: p.cover_source_url,
    description_md: p.description_md,
    role: p.role,
    license: p.license,
    start_year: p.start_year,
    team_size: p.team_size,
    metadata: metadataItems(p.metadata),
    screenshots: p.screenshots.map(toScreenshot),
    // 后台详情含全部笔记（含草稿），逐条带 publish_status 供编辑器区分（前台详情只出已发布）
    notes: p.notes.map((n) => ({
      ...toNoteSummary(n, { slug: p.slug, name: p.name }),
      publish_status: n.publish_status as AdminProjectDetail["notes"][number]["publish_status"],
    })),
  };
}
