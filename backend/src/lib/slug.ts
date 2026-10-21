// slug 相关工具：格式校验（校验本体在 contract/schemas.ts）+ 改名后的旧地址别名（301，B15）
import { prisma } from "./prisma.js";
import type { EntityType } from "../contract/schemas.js";

export const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;

/**
 * 记录旧 slug（改名后旧地址仍可 301 到新地址）。
 * 唯一键 (entity_type, slug)；同一实体多次改名时，旧别名重指到当前实体 id。
 * 调用方保证「从未发布过的草稿改 slug」不写别名（B15）。
 */
export async function recordSlugAlias(
  entity_type: EntityType,
  entity_id: string,
  oldSlug: string,
): Promise<void> {
  if (!SLUG_PATTERN.test(oldSlug)) return;
  await prisma.slugAlias.upsert({
    where: { entity_type_slug: { entity_type, slug: oldSlug } },
    update: { entity_id },
    create: { entity_type, entity_id, slug: oldSlug },
  });
}

/** 查询旧 slug 指向的实体 id（无别名返回 null）。 */
export async function resolveSlugAlias(
  entity_type: EntityType,
  slug: string,
): Promise<string | null> {
  const alias = await prisma.slugAlias.findUnique({
    where: { entity_type_slug: { entity_type, slug } },
    select: { entity_id: true },
  });
  return alias?.entity_id ?? null;
}
