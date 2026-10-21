// 后台项目管理（Bearer 鉴权，/api/v1/admin/*）：
//   GET    /admin/projects                 列表（含 draft/archived/已软删除，可过滤）
//   GET    /admin/projects/:id             详情（含全部笔记，含草稿）
//   POST   /admin/projects                 新建（默认 draft）
//   PATCH  /admin/projects/:id             局部更新（slug 改名保留旧 slug → 301；状态机校验）
//   DELETE /admin/projects/:id             软删除（deleted_at，可 restore）
//   POST   /admin/projects/:id/restore     取消软删除
//   PUT    /admin/projects/:id/metadata    整体替换自定义元数据 KV（B6 键名唯一）
// 契约见 docs/api-contract.md §4.1。
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { recordSlugAlias } from "../../lib/slug.js";
import {
  adminProjectDetailInclude,
  adminProjectListInclude,
  toAdminDetail,
  toAdminListItem,
} from "../../lib/serialize.js";
import {
  AdminProjectListQuerySchema,
  MetadataReplaceSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type PublishStatus,
} from "../../contract/schemas.js";

// 曝光状态机（《开发计划 v1.2》第五节）：draft→published；published→archived / draft（撤回）；archived→published
const STATUS_TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  draft: ["published"],
  published: ["archived", "draft"],
  archived: ["published"],
};

// 技术栈名：去空白 + 按出现顺序去重，index 即 sort
function toTechRows(names: string[]): Array<{ name: string; sort: number }> {
  const seen = new Set<string>();
  const rows: Array<{ name: string; sort: number }> = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, sort: rows.length });
  }
  return rows;
}

async function getProjectOr404(id: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new AppError("NOT_FOUND", "项目不存在");
  return project;
}

// slug 全站唯一（project 命名空间）：占用时 409 CONFLICT，并在 details 指出字段
async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (existing && existing.id !== excludeId) {
    throw new AppError("CONFLICT", `slug「${slug}」已被项目「${existing.name}」占用`, [
      { field: "slug", code: "conflict", message: "slug 已被占用" },
    ]);
  }
}

export async function adminProjectRoutes(app: FastifyInstance) {
  app.get("/projects", async (req) => {
    const q = validate(AdminProjectListQuerySchema, req.query);
    const where: Prisma.ProjectWhereInput = {
      ...(q.includeDeleted ? {} : { deleted_at: null }),
      ...(q.publish_status ? { publish_status: q.publish_status } : {}),
      ...(q.progress ? { progress: q.progress } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search } },
              { summary: { contains: q.search } },
              { slug: { contains: q.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        include: adminProjectListInclude,
        orderBy: { updated_at: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.project.count({ where }),
    ]);

    return {
      items: rows.map(toAdminListItem),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    };
  });

  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: adminProjectDetailInclude,
    });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");
    return toAdminDetail(project);
  });

  app.post("/projects", async (req, reply) => {
    const data = validate(ProjectCreateSchema, req.body);
    await assertSlugFree(data.slug);

    const publishStatus = data.publish_status ?? "draft";
    const project = await prisma.project.create({
      data: {
        slug: data.slug,
        name: data.name,
        summary: data.summary ?? null,
        description_md: data.description_md ?? null,
        cover_image_url: data.cover_image_url ?? null,
        cover_source_url: data.cover_source_url ?? null,
        publish_status: publishStatus,
        published_at: publishStatus === "published" ? new Date() : null,
        progress: data.progress ?? "ongoing",
        stars: data.stars ?? null,
        version: data.version ?? null,
        last_updated_at: data.last_updated_at ? new Date(data.last_updated_at) : null,
        role: data.role ?? null,
        license: data.license ?? null,
        start_year: data.start_year ?? null,
        team_size: data.team_size ?? null,
        tech_stack: data.tech_stack ? { create: toTechRows(data.tech_stack) } : undefined,
      },
      include: adminProjectDetailInclude,
    });
    reply.status(201);
    return toAdminDetail(project);
  });

  app.patch("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const patch = validate(ProjectUpdateSchema, req.body);
    const current = await getProjectOr404(id);

    // slug 改名：校验唯一；已发布过的项目保留旧 slug（B15 旧地址 301 → 新地址）
    if (patch.slug !== undefined && patch.slug !== current.slug) {
      await assertSlugFree(patch.slug, id);
      if (current.published_at) {
        await recordSlugAlias("project", id, current.slug);
      }
    }

    // 暴露状态迁移校验；首次发布时写入 published_at
    let publishedAt = current.published_at;
    if (patch.publish_status !== undefined && patch.publish_status !== current.publish_status) {
      const allowed = STATUS_TRANSITIONS[current.publish_status as PublishStatus];
      if (!allowed.includes(patch.publish_status)) {
        throw new AppError(
          "INVALID_STATUS_TRANSITION",
          `不允许从 ${current.publish_status} 变更为 ${patch.publish_status}`,
          [{ field: "publish_status", code: "invalid_transition", message: "状态迁移不合法" }],
        );
      }
      if (patch.publish_status === "published" && !publishedAt) publishedAt = new Date();
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.description_md !== undefined ? { description_md: patch.description_md } : {}),
        ...(patch.cover_image_url !== undefined
          ? { cover_image_url: patch.cover_image_url }
          : {}),
        ...(patch.cover_source_url !== undefined
          ? { cover_source_url: patch.cover_source_url }
          : {}),
        ...(patch.publish_status !== undefined ? { publish_status: patch.publish_status } : {}),
        published_at: publishedAt,
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.stars !== undefined ? { stars: patch.stars } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
        ...(patch.last_updated_at !== undefined
          ? { last_updated_at: patch.last_updated_at ? new Date(patch.last_updated_at) : null }
          : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.license !== undefined ? { license: patch.license } : {}),
        ...(patch.start_year !== undefined ? { start_year: patch.start_year } : {}),
        ...(patch.team_size !== undefined ? { team_size: patch.team_size } : {}),
        // tech_stack 传数组即整体替换（含 [] 清空），顺序即 sort
        ...(patch.tech_stack !== undefined
          ? { tech_stack: { deleteMany: {}, create: toTechRows(patch.tech_stack) } }
          : {}),
      },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(updated);
  });

  app.delete("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await getProjectOr404(id);
    if (project.deleted_at) {
      // 幂等：已删除的项目重复删除不改动 deleted_at
      const current = await prisma.project.findUniqueOrThrow({
        where: { id },
        include: adminProjectDetailInclude,
      });
      return toAdminDetail(current);
    }
    const deleted = await prisma.project.update({
      where: { id },
      data: { deleted_at: new Date() },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(deleted);
  });

  app.post("/projects/:id/restore", async (req) => {
    const { id } = req.params as { id: string };
    await getProjectOr404(id);
    const restored = await prisma.project.update({
      where: { id },
      data: { deleted_at: null },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(restored);
  });

  // 整体替换自定义元数据（先删后建，同一事务）：重复键名在应用层 400，不落到 409
  app.put("/projects/:id/metadata", async (req) => {
    const { id } = req.params as { id: string };
    const items = validate(MetadataReplaceSchema, req.body);
    await getProjectOr404(id);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projectMetadata.deleteMany({ where: { project_id: id } });
      if (items.length > 0) {
        await tx.projectMetadata.createMany({
          data: items.map((item, index) => ({
            project_id: id,
            key_label: item.key_label,
            value: item.value,
            sort: item.sort ?? index,
          })),
        });
      }
      return tx.project.findUniqueOrThrow({
        where: { id },
        include: adminProjectDetailInclude,
      });
    });
    return toAdminDetail(updated);
  });
}
