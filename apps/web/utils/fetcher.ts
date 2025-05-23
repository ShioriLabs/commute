export const fetcher = <T = unknown>(request: RequestInfo | URL, init?: RequestInit) => fetch(request, init).then(res => res.json() as T)
