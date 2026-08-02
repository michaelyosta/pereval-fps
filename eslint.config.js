import eslint from '@eslint/js';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/qa/**'],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        AudioContext: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        HTMLCanvasElement: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
    },
  },
];
