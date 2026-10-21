// 公开项目读接口（无 Bearer 守卫）：
//   GET /api/v1/projects      已发布项目列表（status=published 且未软删除）
//   GET /api/v1/projects/:id  已发布项目详情（含元数据 + 链接 + 笔记）
// 契约 §3.1 冻结；响应序列化不含 deletedAt（仅 /admin/* 返回）。
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/zod.js";
import {
  projectInclude,
  toPublicDetail,
  toPublicListItem,
} from "../lib/serialize.js";
import { PublicProjectListQuerySchema } from "../contract/schemas.js";

// 前台只可见：已发布且未软删除
const PUBLIC_WHERE: Prisma.ProjectWhereInput = { status: "published", deletedAt: null };

export async function projectRoutes(app: FastifyInstance) {
  // 列表：search（名称/简介模糊）、technology（技术栈名精确）、page/pageSize
  // 默认排序 lastActivityAt desc，为空回退 updatedAt（等价 COALESCE(lastActivityAt, updatedAt) DESC）。
  // MVP 数据量小（个人作品集），在应用层完成该排序；数据量增长后可改为 DB 端 COALESCE 排序 + 游标分页。
  app.get("/projects", async (req) => {
    const q = validate(PublicProjectListQuerySchema, req.query);
    const where: Prisma.ProjectWhereInput = {
      ...PUBLIC_WHERE,
      ...(q.search
        ? { OR: [{ name: { contains: q.search } }, { tagline: { contains: q.search } }] }
        : {}),
      ...(q.technology
        ? { technologies: { some: { technology: { name: q.technology } } } }
        : {}),
    };

    const rows = await prisma.project.findMany({ where, include: projectInclude });
    const sorted = [...rows].sort((a, b) => {
      const ak = a.lastActivityAt?.getTime() ?? a.updatedAt.getTime();
      const bk = b.lastActivityAt?.getTime() ?? b.updatedAt.getTime();
      return bk - ak;
    });
    const total = sorted.length;
    const items = sorted
      .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
      .map(toPublicListItem);

    return {
      items,
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    };
  });

  // 详情：published 且未软删除，否则 404（不泄露草稿/下架/已删项目的存在）
  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({
      where: { id, ...PUBLIC_WHERE },
      include: projectInclude,
    });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");
    return toPublicDetail(project);
  });
}
