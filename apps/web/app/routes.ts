import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  layout('layouts/default.tsx', [
    index('routes/home.tsx'),
    route('search', 'routes/search.tsx'),
    route('station/:operator/:code', 'routes/station.tsx'),
    route('settings', 'routes/settings/index.tsx'),
    route('settings/saved-stations', 'routes/settings/saved-stations.tsx'),
    route('settings/manage-data', 'routes/settings/manage-data.tsx'),
    route('settings/legal', 'routes/settings/legal/index.tsx'),
    route('settings/legal/privacy-policy', 'routes/settings/legal/privacy-policy.tsx'),
    route('settings/legal/terms-conditions', 'routes/settings/legal/terms-conditions.tsx'),
    route('settings/legal/oss-attributions', 'routes/settings/legal/oss-attributions.tsx'),
    route('settings/legal/creative-assets-attributions', 'routes/settings/legal/creative-assets-attributions.tsx')
  ])
] satisfies RouteConfig
