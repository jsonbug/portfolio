import { request } from './client'

/** 全部技术栈名称（前台公开）。 */
export function listTechnologies(): Promise<{ items: string[] }> {
  return request<{ items: string[] }>('/technologies')
}
