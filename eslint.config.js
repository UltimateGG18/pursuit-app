import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/server/prisma/migrations/**',
    ],
  },

  // Config files are plain JS and are not part of a TS project.
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node } },
  },

  // Type-aware linting for every TypeScript source and test file.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/tests/**/*.{ts,tsx}', 'packages/*/*.config.ts'],
  })),
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/tests/**/*.{ts,tsx}', 'packages/*/*.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Promises must be awaited or explicitly discarded with `void`.
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'error',
    },
  },

  // React-specific rules for the frontend.
  {
    files: ['packages/web/src/**/*.{ts,tsx}', 'packages/web/tests/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
