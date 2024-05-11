import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default [
  {
    languageOptions: { globals: globals.browser },
    files: ['apps/**/*.ts'],
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    quotes: 'single',
    semi: false,
    indent: 2,
  }),
]
