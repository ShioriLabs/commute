import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default defineConfig([
  {
    languageOptions: { globals: globals.browser },
    files: ['apps/**/*.ts', 'apps/**/*.tsx']
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    quotes: 'single',
    semi: false,
    indent: 2,
    commaDangle: 'never',
    braceStyle: '1tbs'
  }),
  globalIgnores(['apps/api/.wrangler/**/*'])
])
