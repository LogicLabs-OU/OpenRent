import type { StorybookConfig } from '@storybook/svelte-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

/** The shared components (PRD §11.2): every story is checked with axe (scripts/storybook-a11y.ts). */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.svelte'],
  addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y'],
  framework: { name: '@storybook/svelte-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => {
    // Svelte first: Storybook's own plugins read compiled components.
    config.plugins = [tailwindcss(), svelte({ compilerOptions: { runes: true } }), ...(config.plugins ?? [])];
    return config;
  },
};
export default config;
