import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.output/**', '.wxt/**', 'stats.html'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // TypeScript (and WXT's auto-imported globals: browser, chrome,
      // defineBackground, defineContentScript) are resolved at compile time,
      // so the JS `no-undef` rule is intentionally disabled for TS files.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
