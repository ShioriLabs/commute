import type { StatusCode } from 'hono/utils/http-status'

export interface APIError {
  message: string
  code: string
}

/*
 * A successful response: `data` is present, `error` is not.
 *
 * `error?: never` is what makes the union discriminate. Without it, a value
 * typed as the union would let you read `.error` on the success arm (widened to
 * `APIError | undefined`), and — worse — an object carrying BOTH fields would
 * satisfy the type, which is a response the API never sends.
 */
export interface SuccessResponse<T = unknown> {
  status: StatusCode
  data: T
  error?: never
}

/** A failed response: `error` is present, `data` is not. */
export interface ErrorResponse {
  status: StatusCode
  data?: never
  error: APIError
}

/*
 * Every response is one or the other, never both and never neither.
 *
 * Narrow before reading the payload — `if (res.data)` or `if (res.error)` — and
 * TypeScript resolves the other field for you:
 *
 *   if (res.error) return res.error.message  // res is ErrorResponse here
 *   return res.data                          // and SuccessResponse<T> here
 *
 * Optional chaining (`res.data?.name`) still works on the union, so existing
 * call sites need no change; they simply gain the guarantee that a response
 * carrying `data` cannot also carry `error`.
 */
export type StandardResponse<T = unknown> = SuccessResponse<T> | ErrorResponse
