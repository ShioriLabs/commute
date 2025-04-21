import type { StatusCode } from 'hono/utils/http-status'

export interface StandardResponse<T = unknown> {
  status: StatusCode
  data?: T
  error?: {
    message: string
    code: string
  }
}
