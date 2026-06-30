export class FetchError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`Request failed: ${status} ${statusText}`)
    this.name = 'FetchError'
    this.status = status
  }
}

// Throws on non-2xx so SWR's `error` is reliable — otherwise a 4xx/5xx with a
// JSON body resolves as "success" and surfaces downstream as empty/"no data".
export const fetcher = async <T = unknown>(request: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const res = await fetch(request, init)
  if (!res.ok) throw new FetchError(res.status, res.statusText)
  return res.json() as Promise<T>
}
