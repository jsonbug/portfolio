// Prisma 模型 → 契约响应形状（公开 + 后台管理）
import type { Prisma } from "@prisma/client";

export const projectInclude = {
  technologies: { include: { technology: true } },
  links: true,
  note: true,
} satisfies Prisma.ProjectInclude;

export type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: typeof projectInclude;
}>;

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// 列表项公共字段（前台公开，不含 deletedAt）
const baseListItem = (p: ProjectWithRelations) => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline,
  coverImage: p.coverImage,
  status: p.status,
  stars: p.stars,
  lastActivityAt: toIso(p.lastActivityAt),
  technologies: p.technologies.map((t) => t.technology.name),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

// 详情扩展字段（description/元数据/链接/笔记）
const detailExtras = (p: ProjectWithRelations) => ({
  description: p.description,
  role: p.role,
  projectStatus: p.projectStatus,
  startDate: toIso(p.startDate),
  endDate: toIso(p.endDate),
  githubRepo: p.githubRepo,
  links: [...p.links]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      id: l.id,
      type: l.type,
      label: l.label,
      url: l.url,
      sortOrder: l.sortOrder,
      createdAt: l.createdAt.toISOString(),
    })),
  note: p.note
    ? {
        id: p.note.id,
        title: p.note.title,
        content: p.note.content,
        createdAt: p.note.createdAt.toISOString(),
        updatedAt: p.note.updatedAt.toISOString(),
      }
    : null,
});

// ---------- 前台公开（不含 deletedAt） ----------
export function toPublicListItem(p: ProjectWithRelations) {
  return baseListItem(p);
}

export function toPublicDetail(p: ProjectWithRelations) {
  return { ...baseListItem(p), ...detailExtras(p) };
}

// ---------- 后台管理（额外含 deletedAt） ----------
export function toAdminListItem(p: ProjectWithRelations) {
  return { ...baseListItem(p), deletedAt: toIso(p.deletedAt) };
}

export function toAdminDetail(p: ProjectWithRelations) {
  return { ...baseListItem(p), ...detailExtras(p), deletedAt: toIso(p.deletedAt) };
}

export function toLink(l: {
  id: string;
  type: string;
  label: string | null;
  url: string;
  sortOrder: number;
  createdAt: Date;
}) {
  return {
    id: l.id,
    type: l.type,
    label: l.label,
    url: l.url,
    sortOrder: l.sortOrder,
    createdAt: l.createdAt.toISOString(),
  };
}
