import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (v: string | undefined) => (v ? v : undefined);

/** Where the shop lives (read when the server starts). */
export const variables = defineEnvVars({
  OPENRENT_API_URL: { schema: (v) => (v || 'http://localhost:7070').replace(/\/$/, ''), description: 'Base URL of the OpenRent installation' },
  OPENRENT_PUBLISHABLE_KEY: { schema: optional, description: 'The shop\'s publishable key (pk_…)' },
  OPENRENT_TENANT_SLUG: { schema: optional, description: 'Without a key: the shop\'s slug' },
});
