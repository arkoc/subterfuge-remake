import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Subterfuge ESLint config.
 *
 * The sim/ package is intentionally pure: no Node APIs, no browser APIs,
 * no implicit non-determinism. The rules in the sim block below enforce
 * that — if you find yourself fighting them, the right answer is almost
 * always to move the impure code to server/ or client/ and pass values
 * into the sim as arguments.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // sim/ purity: forbid Node and browser APIs so the same code can run on
  // server and client (and one day in a worker).
  {
    files: ['packages/sim/src/**/*.ts'],
    languageOptions: {
      globals: {},
    },
    rules: {
      'no-restricted-globals': [
        'error',
        // Browser
        { name: 'window', message: 'sim/ must be platform-pure' },
        { name: 'document', message: 'sim/ must be platform-pure' },
        { name: 'navigator', message: 'sim/ must be platform-pure' },
        { name: 'location', message: 'sim/ must be platform-pure' },
        { name: 'fetch', message: 'sim/ must be platform-pure' },
        { name: 'XMLHttpRequest', message: 'sim/ must be platform-pure' },
        { name: 'localStorage', message: 'sim/ must be platform-pure' },
        { name: 'sessionStorage', message: 'sim/ must be platform-pure' },
        // Node
        { name: 'process', message: 'sim/ must be platform-pure' },
        { name: 'Buffer', message: 'sim/ must be platform-pure' },
        { name: '__dirname', message: 'sim/ must be platform-pure' },
        { name: '__filename', message: 'sim/ must be platform-pure' },
        { name: 'global', message: 'sim/ must be platform-pure' },
        // Non-determinism: pass time in as an argument
        { name: 'Date', message: 'sim/ must be deterministic — pass `now` as a parameter' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'fs',
                'fs/*',
                'node:fs',
                'node:fs/*',
                'path',
                'node:path',
                'http',
                'node:http',
                'https',
                'node:https',
                'os',
                'node:os',
                'crypto',
                'node:crypto',
                'child_process',
                'node:child_process',
                'cluster',
                'node:cluster',
                'worker_threads',
                'node:worker_threads',
                'net',
                'node:net',
                'dgram',
                'node:dgram',
                'stream',
                'node:stream',
              ],
              message: 'sim/ must be platform-pure: no Node built-ins',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'sim/ must be deterministic — pass `now` as a parameter',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'sim/ must be deterministic — use the seeded PRNG, not Math.random()',
        },
      ],
    },
  },
);
