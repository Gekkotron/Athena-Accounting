import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-demo/**',
      'dist-types-node/**',
      'node_modules/**',
      'test-results/**',
      'coverage/**',
      'e2e/**',
      'scripts/**',
      'drizzle.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
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
    },
  },
  {
    files: ['tests/**', 'src/db/schema.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
);
