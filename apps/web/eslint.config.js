// ESLint v9 flat config — replaces the legacy `.eslintrc.*` setup so the
// `pnpm lint` command works again. Scope is intentionally tight:
//
//   - TS / TSX only (matches the existing npm-script pattern)
//   - React + react-hooks recommended rules
//   - typescript-eslint recommended (non-type-checked variant — turning on
//     type-aware rules would require a tsconfig.json reference and add
//     several seconds per run; we have tsc --noEmit covering type safety)
//   - A couple of project-specific overrides:
//       * `react/react-in-jsx-scope` off — Vite + React 17+ JSX transform
//       * `@typescript-eslint/no-explicit-any` warn (not error) — there are
//         legitimate any usages in `as never` adapters that we don't want
//         to chase right now
//       * `react/prop-types` off — we use TS prop typing
//
// To extend: drop a new object into the array. Order matters: later
// objects override earlier ones for matching `files`.

import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  // 1. Ignore generated/output dirs so we don't lint them.
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'public/**',
      // tsc -b emits intermediate JS into .tsbuild-node — never the source.
      '.tsbuild-node/**',
      // The codegen output lives outside this package but mirror it just in
      // case someone runs eslint with --config from the repo root.
      'src/types/document.ts',
    ],
  },
  // 2. Core JS recommended rules (applies to every JS/TS file).
  js.configs.recommended,
  // 3. TS / TSX rules — main payload.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Pull in recommended sets explicitly (flat config can't `extends`).
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Project-specific tweaks.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // We override several DOM types — accept the friction over chasing
      // generated noise.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow underscore-prefixed unused args (common convention).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Triple-slash directives appear in vite/client typing imports.
      '@typescript-eslint/triple-slash-reference': 'off',
      // We use empty interfaces as type aliases occasionally.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Many React event handlers shadow outer names harmlessly.
      'no-shadow': 'off',
      // We have legitimate `console.warn` for soft errors.
      'no-console': 'off',
      // The "no-undef" rule is duplicative with TS — disable to avoid
      // false positives on global types like `JSX`.
      'no-undef': 'off',
    },
  },
  // 4. Vitest test files: relax a couple of rules that hurt test ergonomics.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Test files often define helper components inline.
      'react/display-name': 'off',
    },
  },
  // 4b. Node-side scripts (.cjs build helpers, scripts/**) — Node globals.
  {
    files: ['scripts/**/*.{js,cjs,mjs}', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  // 5. Playwright e2e files: their fixture API uses `async ({}, info) => …`
  // where the empty destructure is idiomatic — not a typo. We also relax
  // unused-disable-directive noise that fluctuates with test deltas.
  {
    files: ['tests/e2e/**/*.{ts,tsx}'],
    rules: {
      'no-empty-pattern': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
]
