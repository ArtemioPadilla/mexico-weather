import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'node_modules/**',
      '.husky/**',
      'package-lock.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Pragmatic relaxations so the existing simple site passes cleanly.
      // The inline <script is:inline> blocks use legacy browser patterns
      // (var, IIFE, `arguments`, short-circuit calls) that we do not want
      // to rewrite in the tooling PR.
      'no-var': 'off',
      'prefer-const': 'warn',
      // Inline browser scripts intentionally use the `arguments` object to
      // wrap native APIs (console, fetch) without changing their arity.
      'prefer-rest-params': 'off',
      // env.d.ts uses the standard Astro-generated triple-slash reference.
      '@typescript-eslint/triple-slash-reference': 'off',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Astro inline scripts run in the browser; allow browser globals there.
    files: ['**/*.astro/*.js', '**/*.astro/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  prettier,
];
