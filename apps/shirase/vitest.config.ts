import { defineConfig } from 'vitest/config'

// Plain Node: the worker's only platform pieces (R2, caches.default,
// ExecutionContext) are faked in src/test-helpers.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  }
})
