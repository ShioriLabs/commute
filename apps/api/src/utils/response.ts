import { StandardResponse } from 'models/response'

export function Ok<T = unknown>(data: T): StandardResponse<T> {
  return {
    status: 200,
    data
  }
}

export function BadRequest(errorCode: string = 'BAD_REQUEST', message: string = 'Bad request'): StandardResponse {
  return {
    status: 400,
    error: {
      code: errorCode,
      message
    }
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

export function LengthRequired(errorCode: string = 'LENGTH_REQUIRED', message: string = 'Content-Length is required'): StandardResponse {
  return {
    status: 411,
    error: {
      code: errorCode,
      message
    }
  }
}

export function PayloadTooLarge(errorCode: string = 'PAYLOAD_TOO_LARGE', message: string = 'Payload too large'): StandardResponse {
  return {
    status: 413,
    error: {
      code: errorCode,
      message
    }
  }
}

export function UnsupportedMediaType(errorCode: string = 'UNSUPPORTED_MEDIA_TYPE', message: string = 'Body must be a zstd frame'): StandardResponse {
  return {
    status: 415,
    error: {
      code: errorCode,
      message
    }
  }
}

export function ServiceUnavailable(errorCode: string = 'SERVICE_UNAVAILABLE', message: string = 'Service unavailable'): StandardResponse {
  return {
    status: 503,
    error: {
      code: errorCode,
      message
    }
  }
}
