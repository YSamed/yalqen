import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'release/', 'node_modules/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/renderer/**', 'src/preload/**'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
