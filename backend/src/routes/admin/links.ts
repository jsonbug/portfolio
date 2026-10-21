// 2.4 链接管理：POST /projects/:id/links、PATCH /links/:id、DELETE /links/:id
import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { toLink } from "../../lib/serialize.js";
import { LinkCreateSchema, LinkUpdateSchema } from "../../contract/schemas.js";

async function projectExists(id: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!p) throw new AppError("NOT_FOUND", "项目不存在");
}

export async function adminLinkRoutes(app: FastifyInstance) {
  // 添加链接
  app.post("/projects/:id/links", async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    await projectExists(projectId);
    const body = validate(LinkCreateSchema, req.body);
    const link = await prisma.link.create({
      data: {
        projectId,
        type: body.type,
        label: body.label ?? null,
        url: body.url,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.status(201).send(toLink(link));
  });

  // 更新链接
  app.patch("/links/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = validate(LinkUpdateSchema, req.body);
    const link = await prisma.link.update({
      where: { id },
      data: {
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    return toLink(link);
  });

  // 删除链接
  app.delete("/links/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.link.delete({ where: { id } });
    return reply.status(204).send();
  });
}
