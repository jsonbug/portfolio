// 后台笔记管理（N:1 项目；/api/v1/admin/notes）
//   GET    /admin/notes        列表（可过滤 publish_status / project_id / search）
//   POST   /admin/notes        新建（body.project_id 指定所属项目）
//   GET    /admin/notes/:id    详情（含 body_md）
//   PATCH  /admin/notes/:id    局部更新（slug 改名保留旧 slug → 301；tags 整体替换）
//   DELETE /admin/notes/:id    硬删除
// 契约见 docs/api-contract.md §4.2。
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { recordSlugAlias } from "../../lib/slug.js";
import { likePattern } from "../../lib/like.js";
import { noteInclude, toAdminNoteDetail, toAdminNoteListItem } from "../../lib/serialize.js";
import {
  AdminNoteListQuerySchema,
  NoteCreateSchema,
  NoteUpdateSchema,
} from "../../contract/schemas.js";

function toTagRows(tags: string[] | undefined): Array<{ name: string }> | undefined {
  if (tags === undefined) return undefined;
  const seen = new Set<string>();
  const rows: Array<{ name: string }> = [];
  for (const raw of tags) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ name });
  }
  return rows;
}

async function getNoteOr404(id: string) {
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) throw new AppError("NOT_FOUND", "笔记不存在");
  return note;
}

// slug 在 note 命名空间内唯一（slug_aliases 唯一键是 entity_type+slug，项目与笔记互不冲突）
async function assertNoteSlugFree(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.note.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
  if (existing && existing.id !== excludeId) {
    throw new AppError("CONFLICT", `slug「${slug}」已被笔记「${existing.title}」占用`, [
      { field: "slug", code: "conflict", message: "slug 已被占用" },
    ]);
  }
}

/**
 * 命中的笔记 id（title/body_md/slug 包含关键字，字面量匹配）。
 * 与前台同一手法：`$queryRaw ... LIKE ? ESCAPE '\'` 只取 id，排序与分页（skip/take/count）仍归 Prisma。
 * 后台不限定发布状态——草稿也要能搜到。
 */
async function searchNoteIds(term: string): Promise<string[]> {
  const pattern = likePattern(term);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM notes
    WHERE title LIKE ${pattern} ESCAPE '\\'
       OR body_md LIKE ${pattern} ESCAPE '\\'
       OR slug LIKE ${pattern} ESCAPE '\\'
  `;
  return rows.map((r) => r.id);
}

export async function adminNoteRoutes(app: FastifyInstance) {
  app.get("/notes", async (req) => {
    const q = validate(AdminNoteListQuerySchema, req.query);
    const where: Prisma.NoteWhereInput = {
      ...(q.publish_status ? { publish_status: q.publish_status } : {}),
      ...(q.project_id ? { project_id: q.project_id } : {}),
      ...(q.search ? { id: { in: await searchNoteIds(q.search) } } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.note.findMany({
        where,
        include: noteInclude,
        orderBy: { updated_at: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.note.count({ where }),
    ]);

    return {
      items: rows.map(toAdminNoteListItem),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    };
  });

  app.post("/notes", async (req, reply) => {
    const data = validate(NoteCreateSchema, req.body);
    await assertNoteSlugFree(data.slug);

    const project = await prisma.project.findUnique({
      where: { id: data.project_id },
      select: { id: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "所属项目不存在");

    const publishStatus = data.publish_status ?? "draft";
    const note = await prisma.note.create({
      data: {
        project_id: data.project_id,
        slug: data.slug,
        title: data.title,
        body_md: data.body_md,
        publish_status: publishStatus,
        published_at: publishStatus === "published" ? new Date() : null,
        tags: data.tags ? { create: toTagRows(data.tags) ?? [] } : undefined,
      },
      include: noteInclude,
    });
    reply.status(201);
    return toAdminNoteDetail(note);
  });

  app.get("/notes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const note = await prisma.note.findUnique({ where: { id }, include: noteInclude });
    if (!note) throw new AppError("NOT_FOUND", "笔记不存在");
    return toAdminNoteDetail(note);
  });

  app.patch("/notes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const patch = validate(NoteUpdateSchema, req.body);
    const current = await getNoteOr404(id);

    // 曾发布过的笔记改名保留旧 slug（旧地址 301）；纯草稿不留历史
    if (patch.slug !== undefined && patch.slug !== current.slug) {
      await assertNoteSlugFree(patch.slug, id);
      if (current.published_at) {
        await recordSlugAlias("note", id, current.slug);
      }
    }

    let publishedAt = current.published_at;
    if (patch.publish_status !== undefined && patch.publish_status !== current.publish_status) {
      if (patch.publish_status === "published" && !publishedAt) publishedAt = new Date();
      if (patch.publish_status === "draft") publishedAt = null;
    }

    const updated = await prisma.note.update({
      where: { id },
      data: {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body_md !== undefined ? { body_md: patch.body_md } : {}),
        ...(patch.publish_status !== undefined ? { publish_status: patch.publish_status } : {}),
        published_at: publishedAt,
        ...(patch.tags !== undefined
          ? { tags: { deleteMany: {}, create: toTagRows(patch.tags) ?? [] } }
          : {}),
      },
      include: noteInclude,
    });
    return toAdminNoteDetail(updated);
  });

  app.delete("/notes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await prisma.note.deleteMany({ where: { id } });
    if (result.count === 0) throw new AppError("NOT_FOUND", "笔记不存在");
    reply.status(204);
    return null;
  });
}
