import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  layout('layouts/default.tsx', [
    index('routes/home.tsx'),
    route('search', 'routes/search.tsx'),
    route('station/:operator/:code', 'routes/station.tsx'),
    route('settings', 'routes/settings/index.tsx'),
    route('settings/saved-stations', 'routes/settings/saved-stations.tsx'),
    route('settings/manage-data', 'routes/settings/manage-data.tsx')
  ])
] satisfies RouteConfig
