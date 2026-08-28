import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      js
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-extra-semi': 'error',
      'semi': ['error', 'always'],
      'no-mixed-spaces-and-tabs': 'error',
      'no-multi-spaces': 'error',
      'no-trailing-spaces': 'error',
      'quotes': ['error', 'single', { allowTemplateLiterals: true, avoidEscape: true }]
    }
  }
];
