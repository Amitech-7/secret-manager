import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '.vercel/**', 'api/**', '.kilo/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Web app: browser globals, React hooks rules, and it must never touch the DB package.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sm/db', '@sm/db/*'],
              message: 'The web app must not import the DB package.',
            },
          ],
        },
      ],
    },
  },
  {
    // Shared client logic: runs in browsers and the mobile app, so it must never touch the DB.
    files: ['packages/client/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sm/db', '@sm/db/*'],
              message: 'Client code must not import the DB package.',
            },
          ],
        },
      ],
    },
  },
  {
    // API: the server must never contain the code that could decrypt user data.
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sm/crypto', '@sm/crypto/*'],
              message: 'The API must never import the crypto package (zero-knowledge rule).',
            },
          ],
        },
      ],
    },
  },
)
