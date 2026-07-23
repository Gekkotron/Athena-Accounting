import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-demo/**',
      'dist-e2e/**',
      'dist-types-node/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'postcss.config.js',
      'tailwind.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
    rules: {
      'max-lines': 'off',
    },
  },
);
