import path from 'node:path'
import { defineConfig } from 'vitest/config'

// tsconfig has baseUrl: "src"; mirror the src-root import style for tests.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/db/scripts/**', // one-off codegen (generate*SQL.ts)
        'src/operators/**/generate*.ts', // codegen (e.g. lrtjbdb/generateTimetableSQL.ts)
        'src/db/schemas/**', // Kysely type/schema declarations
        'src/db/data/**', // static topology data
        'src/app.ts' // Worker entry / wiring
      ]
    }
  },
  resolve: {
    alias: {
      utils: path.resolve(__dirname, 'src/utils'),
      db: path.resolve(__dirname, 'src/db'),
      models: path.resolve(__dirname, 'src/models'),
      operators: path.resolve(__dirname, 'src/operators'),
      routes: path.resolve(__dirname, 'src/routes'),
      schemas: path.resolve(__dirname, 'src/schemas'),
      app: path.resolve(__dirname, 'src/app.ts')
    }
  }
})
