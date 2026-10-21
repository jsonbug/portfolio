/** 分页元信息（契约冻结：offset 分页）。 */
export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** 列表分页信封。 */
export interface ListEnvelope<T> extends PaginationMeta {
  items: T[]
}

/** 错误码（冻结值）。 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'INTERNAL_ERROR'

export interface ErrorDetail {
  field: string
  code: string
  message: string
}

/** 错误响应信封（冻结）。 */
export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode | (string & {})
    message: string
    details?: ErrorDetail[]
    requestId?: string
  }
}

export interface PageQuery {
  page?: number
  pageSize?: number
}
