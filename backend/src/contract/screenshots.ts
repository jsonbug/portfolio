// 截图与元数据 kind 的契约形状（本批临时载体）
//
// 为什么单独一个文件：`contract/schemas.ts` 本轮由前端在改（`NoteSummary.excerpt`），
// 两侧同时改同一文件必冲突。本批端点与迁移先做，形状放这里；
// 前端那批合入后，把本文件整并入 `contract/schemas.ts` 并在同一次提交里对齐
// `docs/api-contract.md` 的条文（版本号由产品经理赋，本仓库不再自行挑号）。
//
// 形状口径（已按研发负责人裁定实现，条文待产品经理执笔）：
//   - 截图：`{ id, url, caption, sort }`，按 sort 升序；每项目 ≤10 张；url 必须 http(s)；
//     caption 可空、≤80 字；整体替换语义同 /metadata。
//   - 元数据：条目增 `kind: "meta" | "metric"`，缺省 "meta"；metric ≤2 条，
//     metric 的 key_label ≤16、value ≤12；meta 沿用 key_label ≤50、value ≤500。
import { z } from "zod";

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), { message: "必须是 http(s) 地址" });

export const ScreenshotItemSchema = z.object({
  url: httpUrl,
  caption: z.string().trim().max(80).nullable().optional(),
  sort: z.number().int().min(0).optional(),
});
export type ScreenshotItem = z.infer<typeof ScreenshotItemSchema>;

export const ScreenshotsReplaceSchema = z
  .array(ScreenshotItemSchema)
  .max(10, { message: "每个项目最多 10 张截图" });
export type ScreenshotsReplace = z.infer<typeof ScreenshotsReplaceSchema>;

export const ScreenshotResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
  caption: z.string().nullable(),
  sort: z.number().int(),
});
export type Screenshot = z.infer<typeof ScreenshotResponseSchema>;

export const METADATA_KINDS = ["meta", "metric"] as const;
export type MetadataKind = (typeof METADATA_KINDS)[number];

/** metric 型条目的额外约束（key_label / value 更短：要放进指标卡的格子） */
export const METRIC_LIMITS = { max: 2, keyLabel: 16, value: 12 } as const;

/** PUT /admin/projects/:id/metadata 的条目（kind 缺省 meta，旧请求体不带也照常通过） */
export const MetadataItemWithKindSchema = z.object({
  key_label: z.string().trim().min(1).max(50),
  value: z.string().trim().min(1).max(500),
  kind: z.enum(METADATA_KINDS).optional(),
  sort: z.number().int().min(0).optional(),
});
export type MetadataItemWithKind = z.infer<typeof MetadataItemWithKindSchema>;

/**
 * 整体替换的元数据数组：
 * 1) 键名不可重复（同项目内唯一，撞库前先给 400）
 * 2) metric ≤ 2 条
 * 3) metric 条目的 key_label ≤16、value ≤12（否则指标卡放不下）
 */
export const MetadataReplaceWithKindSchema = z
  .array(MetadataItemWithKindSchema)
  .max(50)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.key_label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key_label"],
          message: "同一项目内元数据键名不可重复",
        });
      }
      seen.add(item.key_label);
    });

    const metrics = items.filter((item) => item.kind === "metric");
    if (metrics.length > METRIC_LIMITS.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `指标卡条目最多 ${METRIC_LIMITS.max} 条（当前 ${metrics.length}）`,
      });
    }
    items.forEach((item, index) => {
      if (item.kind !== "metric") return;
      if (item.key_label.length > METRIC_LIMITS.keyLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key_label"],
          message: `指标卡标签最多 ${METRIC_LIMITS.keyLabel} 字（当前 ${item.key_label.length}）`,
        });
      }
      if (item.value.length > METRIC_LIMITS.value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "value"],
          message: `指标卡数值最多 ${METRIC_LIMITS.value} 字（当前 ${item.value.length}）`,
        });
      }
    });
  });
export type MetadataReplaceWithKind = z.infer<typeof MetadataReplaceWithKindSchema>;

export const MetadataResponseWithKindSchema = z.object({
  key_label: z.string(),
  value: z.string(),
  kind: z.enum(METADATA_KINDS),
  sort: z.number().int(),
});
export type MetadataResponseWithKind = z.infer<typeof MetadataResponseWithKindSchema>;
