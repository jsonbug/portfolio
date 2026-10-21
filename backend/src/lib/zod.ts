// zod 校验 → 契约错误信封（400 VALIDATION_ERROR + 字段级 details）
import type { ZodType } from "zod";
import { AppError, type ErrorDetail } from "./errors.js";

export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    }));
    throw new AppError("VALIDATION_ERROR", "请求参数校验失败", details);
  }
  return result.data;
}
