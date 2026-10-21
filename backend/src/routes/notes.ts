// 公开笔记读接口（F4 独立栏目）：
//   GET /api/v1/notes       已发布笔记列表（所属项目可见才出现）
//   GET /api/v1/notes/:slug 笔记全文；旧 slug 命中 slug_aliases 时 301
// 可见性：《开发计划 v1.2》第五节——notes.publish_status=published 且所属项目可见。
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/zod.js";
import { resolveSlugAlias } from "../lib/slug.js";
import { noteInclude, toNoteSummary, toPublicNoteDetail } from "../lib/serialize.js";
import { PublicNoteListQuerySchema } from "../contract/schemas.js";

// 前台可见笔记：自身已发布 + 所属项目已发布未删除（归档/草稿项目的笔记前台不可见，N3 数据保留）
const PUBLIC_NOTE_WHERE = {
  publish_status: "published",
  project: { publish_status: "published", deleted_at: null },
} satisfies Prisma.NoteWhereInput;

export async function noteRoutes(app: FastifyInstance) {
  app.get("/notes", async (req) => {
    const q = validate(PublicNoteListQuerySchema, req.query);
    const where: Prisma.NoteWhereInput = {
      ...PUBLIC_NOTE_WHERE,
      ...(q.search
        ? { OR: [{ title: { contains: q.search } }, { body_md: { contains: q.search } }] }
        : {}),
      ...(q.tag ? { tags: { some: { name: q.tag } } } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.note.findMany({
        where,
        include: noteInclude,
        orderBy: [{ published_at: "desc" }, { created_at: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.note.count({ where }),
    ]);

    return {
      items: rows.map((n) => toNoteSummary(n, n.project)),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    };
  });

  app.get("/notes/:slug", async (req, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const note = await prisma.note.findFirst({
      where: { slug, ...PUBLIC_NOTE_WHERE },
      include: noteInclude,
    });
    if (note) return toPublicNoteDetail(note);

    const targetId = await resolveSlugAlias("note", slug);
    if (targetId) {
      const target = await prisma.note.findFirst({
        where: { id: targetId, ...PUBLIC_NOTE_WHERE },
        select: { slug: true },
      });
      if (target && target.slug !== slug) {
        return reply.redirect(`/api/v1/notes/${target.slug}`, 301);
      }
    }
    throw new AppError("NOT_FOUND", "笔记不存在");
  });
}
