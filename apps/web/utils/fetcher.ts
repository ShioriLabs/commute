export const fetcher = <T = any>(request: RequestInfo | URL, init?: RequestInit) => fetch(request, init).then(res => res.json() as T)
