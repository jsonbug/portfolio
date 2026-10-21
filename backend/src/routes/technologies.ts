// 技术栈标签列表：GET /api/v1/technologies（前台筛选 + 后台编辑器共用）
// v1.2：标签来自 project_tech_stack（原独立 technology 表已并入），只统计前台可见项目，
// 避免把草稿/归档项目独有的技术暴露在筛选器里。
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function technologyRoutes(app: FastifyInstance) {
  app.get("/technologies", async () => {
    const rows = await prisma.projectTechStack.findMany({
      where: { project: { publish_status: "published", deleted_at: null } },
      select: { name: true },
      distinct: ["name"],
      orderBy: { name: "asc" },
    });
    return { items: rows.map((r) => r.name) };
  });
}
