import { StandardResponse } from "models/response";

export function Ok<T = unknown>(data: T): StandardResponse<T> {
  return {
    status: 200,
    data
  }
}

export function NotFound(errorCode: string = "NOT_FOUND", message: string = "Not found"): StandardResponse {
  return {
    status: 200,
    error: {
      code: errorCode,
      message
    }
  }
}
