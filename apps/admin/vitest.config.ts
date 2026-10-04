import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'hono/jsx' },
  test: { include: ['src/**/*.test.{ts,tsx}'] }
})
