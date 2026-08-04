import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'
import { IS_LITE_BUILD } from '../scripts/lite-flag'

// The full route tree is registered in BOTH builds, lite included. Pruning it
// looks tempting — the lite bundle only hosts the map and the fare page — but
// the shared station and hub sheets link to station, timetable, hub, and line
// pages, and against a pruned tree those <Link>s resolve to nothing and render
// a blank. Scope is enforced at the link layer instead, where an unhosted
// target becomes an absolute link to the full app: see app/lib/exit-links.ts.
// Keeping one tree also keeps typegen's output identical between the builds.
export default [
  layout('layouts/default.tsx', [
    // Lite is served from a subdomain root whose entire purpose is the map, so
    // `/` renders it directly. Not a redirect: that would bounce bookmarks and
    // the PWA start_url, and show /map in the address bar when FDTJ pointed
    // people at the bare subdomain.
    //
    // The explicit id is load-bearing, not decorative. Route ids default to the
    // file path, and configRoutesToRouteManifest throws outright on a duplicate
    // — so registering routes/map.tsx at both `/` and `/map` without one is a
    // hard build failure. `/map` stays registered so existing links and
    // bookmarks into the deep URL keep resolving.
    IS_LITE_BUILD ? index('routes/map.tsx', { id: 'map-index' }) : index('routes/home.tsx'),
    route('search', 'routes/search.tsx'),
    route('fare', 'routes/fare.tsx'),
    route('map', 'routes/map.tsx'),
    route('stations/:operator/:code', 'routes/station.tsx'),
    route('stations/:operator/:code/timetable', 'routes/timetable.tsx'),
    route('hubs/:slug', 'routes/hub.tsx'),
    route('lines/:operator/:lineCode', 'routes/line.tsx'),
    route('settings/saved-stations', 'routes/settings/saved-stations.tsx'),
    route('settings/manage-data', 'routes/settings/manage-data.tsx'),
    route('settings/installation', 'routes/settings/installation/index.tsx')
  ]),
  layout('layouts/static.tsx', [
    route('settings', 'routes/settings/index.tsx'),
    route('settings/legal', 'routes/settings/legal/index.tsx'),
    route('settings/legal/privacy-policy', 'routes/settings/legal/privacy-policy.tsx'),
    route('settings/legal/terms-conditions', 'routes/settings/legal/terms-conditions.tsx'),
    route('settings/legal/oss-attributions', 'routes/settings/legal/oss-attributions.tsx'),
    route('settings/legal/creative-assets-attributions', 'routes/settings/legal/creative-assets-attributions.tsx'),
    route('settings/legal/data-attributions', 'routes/settings/legal/data-attributions.tsx'),
    route('settings/about', 'routes/settings/about.tsx')
  ])
] satisfies RouteConfig
