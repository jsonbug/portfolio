/**
 * SQL `LIKE` 的元字符转义（唯一实现，前台与后台共用）。
 *
 * Prisma 的 `contains` 编译成不带 `ESCAPE` 子句的 `LIKE ?`：只把 `%` 换成 `\%` 是无效的——
 * SQLite 会把反斜杠当普通字符、`%` 仍是通配符，结果是「看起来修了、其实还是命中全库」。
 * 因此使用方必须写成 `... LIKE ? ESCAPE '\'`，并把本函数的结果作为参数：
 *
 * ```ts
 * const rows = await prisma.$queryRaw`
 *   SELECT id FROM notes WHERE title LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'
 * `;
 * ```
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 包含式模糊匹配的 pattern（先转义再包 `%`）——与 `LIKE ? ESCAPE '\'` 配套使用。 */
export function likePattern(term: string): string {
  return `%${escapeLike(term)}%`;
}
