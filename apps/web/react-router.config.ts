import type { Config } from '@react-router/dev/config'

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: false,
  prerender: [
    '/settings/legal',
    '/settings/legal/privacy-policy',
    '/settings/legal/terms-conditions',
    '/settings/legal/data-attributions',
    '/settings/legal/oss-attributions',
    '/settings/legal/creative-assets-attributions',
    '/settings/about'
  ]
} satisfies Config
