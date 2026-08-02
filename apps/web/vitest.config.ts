import { defineConfig } from 'vitest/config'

// Standalone config: the main vite.config.ts loads the react-router and
// cloudflare plugins, which vitest doesn't need (and chokes on).
export default defineConfig({
  test: {
    include: ['utils/**/*.test.ts', 'app/**/*.test.ts', 'functions/**/*.test.ts']
  }
})
