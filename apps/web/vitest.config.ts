import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone config: the main vite.config.ts loads the react-router and
// cloudflare plugins, which vitest doesn't need (and chokes on). Those plugins
// also carried the path resolution, so the aliases have to be restated here or
// anything importing `~/…` / `utils/…` fails to resolve under test.
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      'utils': fileURLToPath(new URL('./utils', import.meta.url)),
      '@schema/response': fileURLToPath(new URL('../api/src/models/response.ts', import.meta.url)),
      '@schema': fileURLToPath(new URL('../api/src/db/schemas', import.meta.url))
    }
  },
  test: {
    include: [
      'utils/**/*.test.ts',
      'app/**/*.test.ts',
      'functions/**/*.test.ts',
      'scripts/**/*.test.ts'
    ]
  }
})
