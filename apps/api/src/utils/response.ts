import { StandardResponse } from 'models/response'

export function Ok<T = unknown>(data: T): StandardResponse<T> {
  return {
    status: 200,
    data
  }
}

export function NotFound(errorCode: string = 'NOT_FOUND', message: string = 'Not found'): StandardResponse {
  return {
    status: 404,
    error: {
      code: errorCode,
      message
    }
  }
}

export function Internal(errorCode: string = 'INTERNAL', message: string = 'Internal server error'): StandardResponse {
  return {
    status: 500,
    error: {
      code: errorCode,
      message
    }
  }
}
