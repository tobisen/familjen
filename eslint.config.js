import prettier from 'eslint-config-prettier'
import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
export default ts.config(
  {
    ignores: [
      'dist/**',
      'supabase/functions/push-worker/**',
      'private-registration/**',
      'private-imports/**',
      'dist-e2e/**',
      'dist-shell/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
  prettier,
)
