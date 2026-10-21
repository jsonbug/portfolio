// 后台链接管理（/api/v1/admin/links）
//   POST   /admin/projects/:id/links  新增（sort 缺省 = 该分类末尾）
//   PATCH  /admin/links/:id           局部更新
//   DELETE /admin/links/:id           删除
//   POST   /admin/links/:id/check     立即重检（B16，同步等结果，最长 ~8s）
// 新增 / 改 url 后异步触发健康检查（不阻塞响应，响应里 last_status 仍为 unknown）；
// last_status / last_http_status / last_checked_at 由服务端维护，写接口不接受这三个字段。
// 契约见 docs/api-contract.md §4.4。
import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { toLink } from "../../lib/serialize.js";
import { runLinkCheck, scheduleLinkCheck } from "../../lib/link-check.js";
import { LinkCreateSchema, LinkUpdateSchema } from "../../contract/schemas.js";

export async function adminLinkRoutes(app: FastifyInstance) {
  app.post("/projects/:id/links", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = validate(LinkCreateSchema, req.body);

    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");

    let sort = data.sort;
    if (sort === undefined) {
      const last = await prisma.projectLink.findFirst({
        where: { project_id: id },
        orderBy: { sort: "desc" },
        select: { sort: true },
      });
      sort = (last?.sort ?? -1) + 1;
    }

    const link = await prisma.projectLink.create({
      data: { project_id: id, type: data.type, url: data.url, label: data.label ?? null, sort },
    });
    scheduleLinkCheck(link.id);
    reply.status(201);
    return toLink(link);
  });

  app.patch("/links/:id", async (req) => {
    const { id } = req.params as { id: string };
    const patch = validate(LinkUpdateSchema, req.body);
    const exists = await prisma.projectLink.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError("NOT_FOUND", "链接不存在");

    const link = await prisma.projectLink.update({
      where: { id },
      data: {
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      },
    });
    // url 变了才重检（纯改标签/排序没必要打网络）
    if (patch.url !== undefined) scheduleLinkCheck(link.id);
    return toLink(link);
  });

  // 立即重检：同步等待结果并返回更新后的链接（后台「重检」按钮）
  app.post("/links/:id/check", async (req) => {
    const { id } = req.params as { id: string };
    const link = await runLinkCheck(id);
    if (!link) throw new AppError("NOT_FOUND", "链接不存在");
    return link;
  });

  app.delete("/links/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await prisma.projectLink.deleteMany({ where: { id } });
    if (result.count === 0) throw new AppError("NOT_FOUND", "链接不存在");
    reply.status(204);
    return null;
  });
}
