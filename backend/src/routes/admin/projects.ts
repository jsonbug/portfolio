// 后台项目管理（Bearer 鉴权，/api/v1/admin/*）：
//   GET    /admin/projects                 列表（含 draft/archived/已软删除，可过滤）
//   GET    /admin/projects/:id             详情（含全部笔记，含草稿）
//   POST   /admin/projects                 新建（默认 draft）
//   PATCH  /admin/projects/:id             局部更新（slug 改名保留旧 slug → 301；状态机校验）
//   DELETE /admin/projects/:id             软删除（deleted_at，可 restore）
//   POST   /admin/projects/:id/restore     取消软删除
//   PUT    /admin/projects/:id/metadata    整体替换自定义元数据 KV（B6 键名唯一；条目带 kind: meta|metric）
//   PUT    /admin/projects/:id/screenshots 整体替换截图（≤10 张，url 必须 http(s)，sort 即顺序）
// 契约见 docs/api-contract.md §4.1。
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../lib/zod.js";
import { recordSlugAlias } from "../../lib/slug.js";
import { likePattern } from "../../lib/like.js";
import {
  adminProjectDetailInclude,
  adminProjectListInclude,
  toAdminDetail,
  toAdminListItem,
} from "../../lib/serialize.js";
import {
  AdminProjectListQuerySchema,
  MetadataReplaceSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ScreenshotsReplaceSchema,
  type PublishStatus,
} from "../../contract/schemas.js";

// 曝光状态机（《开发计划 v1.2》第五节）：draft→published；published→archived / draft（撤回）；archived→published
const STATUS_TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  draft: ["published"],
  published: ["archived", "draft"],
  archived: ["published"],
};

// 技术栈名：去空白 + 按出现顺序去重，index 即 sort
function toTechRows(names: string[]): Array<{ name: string; sort: number }> {
  const seen = new Set<string>();
  const rows: Array<{ name: string; sort: number }> = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, sort: rows.length });
  }
  return rows;
}

async function getProjectOr404(id: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new AppError("NOT_FOUND", "项目不存在");
  return project;
}

// slug 全站唯一（project 命名空间）：占用时 409 CONFLICT，并在 details 指出字段
async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (existing && existing.id !== excludeId) {
    throw new AppError("CONFLICT", `slug「${slug}」已被项目「${existing.name}」占用`, [
      { field: "slug", code: "conflict", message: "slug 已被占用" },
    ]);
  }
}

// 命中的项目 id（name/summary/slug 包含关键字，字面量匹配）。
// Prisma 的 `contains` 编译成不带 ESCAPE 的 LIKE，搜「100%」会命中全库；这里先转义再走 `ESCAPE '\'`，
// 只取 id 集合（过滤/计数仍然交给 Prisma，与前台笔记同一手法）。
async function searchProjectIds(term: string): Promise<string[]> {
  const pattern = likePattern(term);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM projects
    WHERE name LIKE ${pattern} ESCAPE '\\'
       OR summary LIKE ${pattern} ESCAPE '\\'
       OR slug LIKE ${pattern} ESCAPE '\\'
  `;
  return rows.map((r) => r.id);
}

export async function adminProjectRoutes(app: FastifyInstance) {
  app.get("/projects", async (req) => {
    const q = validate(AdminProjectListQuerySchema, req.query);
    // 分段计数口径（B9）：search + includeDeleted 过滤后、publish_status 过滤前的集合
    const baseWhere: Prisma.ProjectWhereInput = {
      ...(q.includeDeleted ? {} : { deleted_at: null }),
      ...(q.search ? { id: { in: await searchProjectIds(q.search) } } : {}),
    };
    const where: Prisma.ProjectWhereInput = {
      ...baseWhere,
      ...(q.publish_status ? { publish_status: q.publish_status } : {}),
      ...(q.progress ? { progress: q.progress } : {}),
    };

    const [rows, total, draftCount, publishedCount, archivedCount] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        include: adminProjectListInclude,
        orderBy: { updated_at: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.project.count({ where }),
      prisma.project.count({ where: { ...baseWhere, publish_status: "draft" } }),
      prisma.project.count({ where: { ...baseWhere, publish_status: "published" } }),
      prisma.project.count({ where: { ...baseWhere, publish_status: "archived" } }),
    ]);

    // note_count：本页项目的笔记数，**一次聚合查完**，不逐行查（避免 N+1）。
    // 口径与分段计数不一样：它是「这个项目一共有几篇笔记」，与 search / publish_status 过滤无关；
    // 笔记无软删（后台删除是硬删），所以也不需要排除已删——草稿 + 已发布一起数才是后台要的。
    // 用 `$queryRaw` 而不是 `groupBy`：后者的 `_count` 返回类型在 TS 下是 `true | {…}` 联合，
    // 取值要上游定义成可选字段才能过编译，反倒要写断言；这里显式声明行类型更干净。
    const ids = rows.map((r) => r.id);
    const noteRows = ids.length
      ? await prisma.$queryRaw<Array<{ project_id: string; count: number }>>`
          SELECT project_id, COUNT(*) AS count FROM notes
          WHERE project_id IN (${Prisma.join(ids)})
          GROUP BY project_id
        `
      : [];
    const noteCountByProject = new Map(noteRows.map((n) => [n.project_id, Number(n.count)]));

    // 四项满足 all = draft + published + archived（publish_status 三值穷尽）
    const counts = {
      all: draftCount + publishedCount + archivedCount,
      draft: draftCount,
      published: publishedCount,
      archived: archivedCount,
    };

    return {
      items: rows.map((r) => toAdminListItem(r, noteCountByProject.get(r.id) ?? 0)),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
      counts,
    };
  });

  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: adminProjectDetailInclude,
    });
    if (!project) throw new AppError("NOT_FOUND", "项目不存在");
    return toAdminDetail(project);
  });

  app.post("/projects", async (req, reply) => {
    const data = validate(ProjectCreateSchema, req.body);
    await assertSlugFree(data.slug);

    const publishStatus = data.publish_status ?? "draft";
    const project = await prisma.project.create({
      data: {
        slug: data.slug,
        name: data.name,
        summary: data.summary ?? null,
        description_md: data.description_md ?? null,
        cover_image_url: data.cover_image_url ?? null,
        cover_source_url: data.cover_source_url ?? null,
        publish_status: publishStatus,
        published_at: publishStatus === "published" ? new Date() : null,
        progress: data.progress ?? "ongoing",
        stars: data.stars ?? null,
        version: data.version ?? null,
        last_updated_at: data.last_updated_at ? new Date(data.last_updated_at) : null,
        role: data.role ?? null,
        license: data.license ?? null,
        start_year: data.start_year ?? null,
        team_size: data.team_size ?? null,
        tech_stack: data.tech_stack ? { create: toTechRows(data.tech_stack) } : undefined,
      },
      include: adminProjectDetailInclude,
    });
    reply.status(201);
    return toAdminDetail(project);
  });

  app.patch("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const patch = validate(ProjectUpdateSchema, req.body);
    const current = await getProjectOr404(id);

    // slug 改名：校验唯一；已发布过的项目保留旧 slug（B15 旧地址 301 → 新地址）
    if (patch.slug !== undefined && patch.slug !== current.slug) {
      await assertSlugFree(patch.slug, id);
      if (current.published_at) {
        await recordSlugAlias("project", id, current.slug);
      }
    }

    // 暴露状态迁移校验；首次发布时写入 published_at
    let publishedAt = current.published_at;
    if (patch.publish_status !== undefined && patch.publish_status !== current.publish_status) {
      const allowed = STATUS_TRANSITIONS[current.publish_status as PublishStatus];
      if (!allowed.includes(patch.publish_status)) {
        throw new AppError(
          "INVALID_STATUS_TRANSITION",
          `不允许从 ${current.publish_status} 变更为 ${patch.publish_status}`,
          [{ field: "publish_status", code: "invalid_transition", message: "状态迁移不合法" }],
        );
      }
      if (patch.publish_status === "published" && !publishedAt) publishedAt = new Date();
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.description_md !== undefined ? { description_md: patch.description_md } : {}),
        ...(patch.cover_image_url !== undefined
          ? { cover_image_url: patch.cover_image_url }
          : {}),
        ...(patch.cover_source_url !== undefined
          ? { cover_source_url: patch.cover_source_url }
          : {}),
        ...(patch.publish_status !== undefined ? { publish_status: patch.publish_status } : {}),
        published_at: publishedAt,
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.stars !== undefined ? { stars: patch.stars } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
        ...(patch.last_updated_at !== undefined
          ? { last_updated_at: patch.last_updated_at ? new Date(patch.last_updated_at) : null }
          : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.license !== undefined ? { license: patch.license } : {}),
        ...(patch.start_year !== undefined ? { start_year: patch.start_year } : {}),
        ...(patch.team_size !== undefined ? { team_size: patch.team_size } : {}),
        // tech_stack 传数组即整体替换（含 [] 清空），顺序即 sort
        ...(patch.tech_stack !== undefined
          ? { tech_stack: { deleteMany: {}, create: toTechRows(patch.tech_stack) } }
          : {}),
      },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(updated);
  });

  app.delete("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await getProjectOr404(id);
    if (project.deleted_at) {
      // 幂等：已删除的项目重复删除不改动 deleted_at
      const current = await prisma.project.findUniqueOrThrow({
        where: { id },
        include: adminProjectDetailInclude,
      });
      return toAdminDetail(current);
    }
    const deleted = await prisma.project.update({
      where: { id },
      data: { deleted_at: new Date() },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(deleted);
  });

  app.post("/projects/:id/restore", async (req) => {
    const { id } = req.params as { id: string };
    await getProjectOr404(id);
    const restored = await prisma.project.update({
      where: { id },
      data: { deleted_at: null },
      include: adminProjectDetailInclude,
    });
    return toAdminDetail(restored);
  });

  // 整体替换自定义元数据（先删后建，同一事务）：重复键名 / metric 上限在应用层 400，不落到 409
  // kind 缺省 meta（旧请求体不带也能过，不做破坏性变更）；metric 走详情页指标卡，≤2 条。
  app.put("/projects/:id/metadata", async (req) => {
    const { id } = req.params as { id: string };
    const items = validate(MetadataReplaceSchema, req.body);
    await getProjectOr404(id);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projectMetadata.deleteMany({ where: { project_id: id } });
      if (items.length > 0) {
        await tx.projectMetadata.createMany({
          data: items.map((item, index) => ({
            project_id: id,
            key_label: item.key_label,
            value: item.value,
            kind: item.kind ?? "meta",
            sort: item.sort ?? index,
          })),
        });
      }
      // 元数据是详情页内容的一部分：必须 bump projects.updated_at，否则前台 recent 排序看不出改过
      const bumped = await tx.project.update({
        where: { id },
        data: { updated_at: new Date() },
        include: adminProjectDetailInclude,
      });
      return bumped;
    });
    return toAdminDetail(updated);
  });

  // 整体替换截图（先删后建，同一事务）：≤10 张、url 必须 http(s)、caption ≤80 字，
  // 顺序即 sort（不传 sort 时按数组下标），整体替换语义与 /metadata 一致（传 [] 即清空）。
  app.put("/projects/:id/screenshots", async (req) => {
    const { id } = req.params as { id: string };
    const items = validate(ScreenshotsReplaceSchema, req.body);
    await getProjectOr404(id);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projectScreenshot.deleteMany({ where: { project_id: id } });
      if (items.length > 0) {
        await tx.projectScreenshot.createMany({
          data: items.map((item, index) => ({
            project_id: id,
            url: item.url,
            // 空白图注归一为 null：否则前端要区分 "" 与 null 两种「无图注」
            caption: item.caption?.trim() ? item.caption.trim() : null,
            sort: item.sort ?? index,
          })),
        });
      }
      // 截图同样属于详情页内容，bump updated_at（同 /metadata 口径）
      return tx.project.update({
        where: { id },
        data: { updated_at: new Date() },
        include: adminProjectDetailInclude,
      });
    });
    return toAdminDetail(updated);
  });
}
