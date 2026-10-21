// 公开项目读接口（无 Bearer 守卫）：
//   GET /api/v1/projects       前台列表：仅 publish_status=published 且未软删除
//                              （归档/草稿前台不可见，也不参与分段；F1/F6）
//   GET /api/v1/projects/:slug 详情（含固定元数据 + 自定义 KV + 链接 + 相关笔记）
//                              旧 slug 命中 slug_aliases 时 301 到新地址（B15）
// 契约见 docs/api-contract.md §3.1；响应不含 publish_status / deleted_at。
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/zod.js";
import { resolveSlugAlias } from "../lib/slug.js";
import {
  projectListInclude,
  publicProjectDetailInclude,
  toPublicDetail,
  toPublicListItem,
  type ProjectListRow,
} from "../lib/serialize.js";
import { PublicProjectListQuerySchema } from "../contract/schemas.js";

// 前台只可见：已发布且未软删除（《开发计划 v1.2》第五节「状态与可见性判定」唯一口径）
const PUBLIC_WHERE = {
  publish_status: "published",
  deleted_at: null,
} satisfies Prisma.ProjectWhereInput;

// 最近更新排序键：last_updated_at（手填）为空时回退系统 updated_at
const recentKey = (p: ProjectListRow): number =>
  (p.last_updated_at ?? p.updated_at).getTime();

function sortRows(rows: ProjectListRow[], sort: "recent" | "stars"): ProjectListRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "stars") {
      const byStars = (b.stars ?? -1) - (a.stars ?? -1);
      if (byStars !== 0) return byStars;
    }
    return recentKey(b) - recentKey(a);
  });
}

export async function projectRoutes(app: FastifyInstance) {
  // 列表：search（名称/摘要模糊）、technology（多选，匹配任意一个）、progress（进展分段）、sort
  app.get("/projects", async (req) => {
    const q = validate(PublicProjectListQuerySchema, req.query);
    const where: Prisma.ProjectWhereInput = {
      ...PUBLIC_WHERE,
      ...(q.search
        ? { OR: [{ name: { contains: q.search } }, { summary: { contains: q.search } }] }
        : {}),
      ...(q.technology ? { tech_stack: { some: { name: { in: q.technology } } } } : {}),
    };

    // 数据量小（个人作品集 ≤100 项目）：一次取回后在应用层排序/分段计数。
    // 增长到需要 DB 端排序时，改为 orderBy + 游标分页，并单独聚合 counts。
    const rows = await prisma.project.findMany({ where, include: projectListInclude });

    // 分段计数按「搜索 + 技术栈」过滤后、progress 过滤前的集合口径（F6 统计数字三项口径）
    const counts = {
      all: rows.length,
      ongoing: rows.filter((r) => r.progress === "ongoing").length,
      launched: rows.filter((r) => r.progress === "launched").length,
    };

    const filtered = q.progress ? rows.filter((r) => r.progress === q.progress) : rows;
    const sorted = sortRows(filtered, q.sort);
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
      counts,
    };
  });

  // 详情：slug 定位。旧 slug → 301 到新地址（仅当目标项目仍在前台可见时跳转，否则 404）
  app.get("/projects/:slug", async (req, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const project = await prisma.project.findFirst({
      where: { slug, ...PUBLIC_WHERE },
      include: publicProjectDetailInclude,
    });
    if (project) return toPublicDetail(project);

    const targetId = await resolveSlugAlias("project", slug);
    if (targetId) {
      const target = await prisma.project.findFirst({
        where: { id: targetId, ...PUBLIC_WHERE },
        select: { slug: true },
      });
      if (target && target.slug !== slug) {
        return reply.redirect(`/api/v1/projects/${target.slug}`, 301);
      }
    }
    // 草稿/归档/已删除项目一律 404，不泄露其存在
    throw new AppError("NOT_FOUND", "项目不存在");
  });
}
