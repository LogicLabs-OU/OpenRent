import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/.svelte-kit/**', '**/.svelte-kit-*/**', '**/storybook-static/**', '**/node_modules/**', '**/*.svelte', 'packages/sdk/src/types.ts', '.dev/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Error messages reach users, so core builds them with msg() from the catalogues.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "NewExpression[callee.name='AppError'] > :matches(Literal, TemplateLiteral).arguments:nth-child(3)",
          "CallExpression[callee.name=/^(invalid|forbidden)$/] > :matches(Literal, TemplateLiteral).arguments:nth-child(1)",
          "CallExpression[callee.name='conflict'] > :matches(Literal, TemplateLiteral).arguments:nth-child(2)",
          "Property[key.name='message'] > :matches(Literal, TemplateLiteral).value",
        ].map((selector) => ({ selector, message: 'Use msg() with a catalogue key for messages users see.' })),
      ],
    },
  },
);
