import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  layout('layouts/default.tsx', [
    index('routes/home.tsx'),
    route('search', 'routes/search.tsx'),
    route('station/:operator/:code', 'routes/station.tsx')
  ])
] satisfies RouteConfig
