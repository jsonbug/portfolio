// 2.2 项目 CRUD + 发布/下架/软删除恢复，2.3 元数据（技术栈多值标签 + 元数据标量字段）
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import {
  projectInclude,
  toAdminDetail,
  toAdminListItem,
  type ProjectWithRelations,
} from "../../lib/serialize.js";
import {
  AdminProjectListQuerySchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type ProjectStatus,
} from "../../contract/schemas.js";

// 状态机（契约冻结）：仅允许 draft→published、published→archived、archived→published；
// 其余（跨级 draft↔archived、published→draft 回退草稿）一律 400 INVALID_STATUS_TRANSITION。
// 相同状态视为 no-op（不报错）。
const STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ["published"],
  published: ["archived"],
  archived: ["published"],
};

// ISO 字符串 → Date；undefined 保留（不更新），null 清空
const dateUpdate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

// 技术栈名去重、按名 upsert，返回 technology id 列表
async function upsertTechnologyIds(names: string[]): Promise<string[]> {
  const unique = [...new Set(names.map((n) => n.trim()))].filter(Boolean);
  const ids: string[] = [];
  for (const name of unique) {
    const tech = await prisma.technology.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    ids.push(tech.id);
  }
  return ids;
}

async function getProjectOr404(id: string): Promise<ProjectWithRelations> {
  const project = await prisma.project.findUnique({
    where: { id },
    include: projectInclude,
  });
  if (!project) throw new AppError("NOT_FOUND", "项目不存在");
  return project;
}

export async function adminProjectRoutes(app: FastifyInstance) {
  // 列表（含草稿/下架；includeDeleted=true 含已删除；status/search 过滤）
  app.get("/projects", async (req) => {
    const q = validate(AdminProjectListQuerySchema, req.query);
    const where: Prisma.ProjectWhereInput = {
      ...(q.includeDeleted ? {} : { deletedAt: null }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search } }, { tagline: { contains: q.search } }] }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        include: projectInclude,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.project.count({ where }),
    ]);
    return {
      items: items.map(toAdminListItem),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    };
  });

  // 详情（任意状态）
  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toAdminDetail(await getProjectOr404(id));
  });

  // 创建
  app.post("/projects", async (req, reply) => {
    const body = validate(ProjectCreateSchema, req.body);
    const technologyIds = body.technologies
      ? await upsertTechnologyIds(body.technologies)
      : [];
    const project = await prisma.project.create({
      data: {
        name: body.name,
        tagline: body.tagline ?? null,
        description: body.description ?? null,
        coverImage: body.coverImage ?? null,
        status: body.status ?? "draft",
        stars: body.stars ?? null,
        lastActivityAt: body.lastActivityAt ? new Date(body.lastActivityAt) : null,
        role: body.role ?? null,
        projectStatus: body.projectStatus ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        githubRepo: body.githubRepo ?? null,
        technologies: {
          create: technologyIds.map((technologyId) => ({ technologyId })),
        },
      },
      include: projectInclude,
    });
    return reply.status(201).send(toAdminDetail(project));
  });

  // 更新（含发布/下架：status 字段；technologies 为全量替换）
  app.patch("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const current = await getProjectOr404(id);
    const body = validate(ProjectUpdateSchema, req.body);

    if (body.status !== undefined && body.status !== current.status) {
      const legal = STATUS_TRANSITIONS[current.status as ProjectStatus].includes(body.status);
      if (!legal) {
        throw new AppError(
          "INVALID_STATUS_TRANSITION",
          `不允许的状态迁移：${current.status} → ${body.status}`,
        );
      }
    }

    if (body.technologies) {
      const technologyIds = await upsertTechnologyIds(body.technologies);
      await prisma.$transaction([
        prisma.projectTechnology.deleteMany({ where: { projectId: id } }),
        prisma.projectTechnology.createMany({
          data: technologyIds.map((technologyId) => ({ projectId: id, technologyId })),
        }),
      ]);
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.coverImage !== undefined ? { coverImage: body.coverImage } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.stars !== undefined ? { stars: body.stars } : {}),
        ...(body.lastActivityAt !== undefined
          ? { lastActivityAt: dateUpdate(body.lastActivityAt) }
          : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.projectStatus !== undefined ? { projectStatus: body.projectStatus } : {}),
        ...(body.startDate !== undefined ? { startDate: dateUpdate(body.startDate) } : {}),
        ...(body.endDate !== undefined ? { endDate: dateUpdate(body.endDate) } : {}),
        ...(body.githubRepo !== undefined ? { githubRepo: body.githubRepo } : {}),
      },
      include: projectInclude,
    });
    return toAdminDetail(project);
  });

  // 软删除（置 deletedAt，可恢复；不物理删除笔记/链接/元数据）
  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await getProjectOr404(id);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });

  // 恢复软删除
  app.post("/projects/:id/restore", async (req) => {
    const { id } = req.params as { id: string };
    await getProjectOr404(id);
    const project = await prisma.project.update({
      where: { id },
      data: { deletedAt: null },
      include: projectInclude,
    });
    return toAdminDetail(project);
  });
}
