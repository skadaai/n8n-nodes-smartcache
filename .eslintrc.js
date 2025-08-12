/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
  root: true,

  env: {
    browser: false,
    es6: true,
    node: true,
  },

  parser: '@typescript-eslint/parser',

  parserOptions: {
    project: ['./tsconfig.json'],
    sourceType: 'module',
  },

  plugins: ['eslint-plugin-n8n-nodes-base'],
  extends: ['plugin:n8n-nodes-base/nodes'],

  ignorePatterns: ['.eslintrc.js', '**/*.js', '**/node_modules/**', '**/dist/**'],

  rules: {
    'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'off',
    'n8n-nodes-base/node-resource-description-filename-against-convention': 'off',
    'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
    'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
  },
}
