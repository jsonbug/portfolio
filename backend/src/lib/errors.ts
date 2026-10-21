// 统一错误信封（与 docs/api-contract.md 冻结的错误码一致）

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATUS_TRANSITION"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  code: string;
  message: string;
}

export const errorStatusMap: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATUS_TRANSITION: 400,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toErrorEnvelope(err: AppError, requestId?: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}
