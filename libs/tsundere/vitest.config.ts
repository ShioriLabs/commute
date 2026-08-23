import { defineConfig } from 'vitest/config'

// No aliases: this package uses relative imports only, deliberately. See
// tsconfig.json for why.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
    }
  }
})
