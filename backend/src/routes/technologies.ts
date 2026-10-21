// 技术栈标签列表：GET /api/v1/technologies（前台筛选下拉 + 后台编辑器共用）
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function technologyRoutes(app: FastifyInstance) {
  app.get("/technologies", async () => {
    const techs = await prisma.technology.findMany({ orderBy: { name: "asc" } });
    return { items: techs.map((t) => t.name) };
  });
}
