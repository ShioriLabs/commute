import type { Config } from '@react-router/dev/config'
import { IS_LITE_BUILD } from './scripts/lite-flag'

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: false,
  // Prerendering these emits real settings/**/index.html files into the build.
  // The lite bundle links to none of them, and each one is a file the .htaccess
  // SPA rewrite would then have to be careful not to clobber — so it ships
  // without them rather than with eight unreachable pages.
  prerender: IS_LITE_BUILD
    ? []
    : [
        '/settings/legal',
        '/settings/legal/privacy-policy',
        '/settings/legal/terms-conditions',
        '/settings/legal/data-attributions',
        '/settings/legal/oss-attributions',
        '/settings/legal/creative-assets-attributions',
        '/settings/about'
      ]
} satisfies Config
