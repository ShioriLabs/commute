import path from 'node:path'
import { defineConfig } from 'vitest/config'

// tsconfig has baseUrl: "src"; mirror the src-root import style for tests.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  },
  resolve: {
    alias: {
      utils: path.resolve(__dirname, 'src/utils'),
      db: path.resolve(__dirname, 'src/db'),
      models: path.resolve(__dirname, 'src/models'),
      operators: path.resolve(__dirname, 'src/operators'),
      routes: path.resolve(__dirname, 'src/routes'),
      app: path.resolve(__dirname, 'src/app.ts')
    }
  }
})
