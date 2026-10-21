// 2.5 笔记管理（1:1 项目）：PUT /projects/:id/note（幂等 upsert）、DELETE /projects/:id/note
import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { NoteUpsertSchema } from "../../contract/schemas.js";

export async function adminNoteRoutes(app: FastifyInstance) {
  // 创建/替换项目笔记（1:1，幂等）
  app.put("/projects/:id/note", async (req) => {
    const { id: projectId } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");
    const body = validate(NoteUpsertSchema, req.body);
    const note = await prisma.note.upsert({
      where: { projectId },
      update: { title: body.title, content: body.content },
      create: { projectId, title: body.title, content: body.content },
    });
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  });

  // 删除笔记（幂等：笔记不存在也返回 204）
  app.delete("/projects/:id/note", async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");
    await prisma.note.deleteMany({ where: { projectId } });
    return reply.status(204).send();
  });
}
