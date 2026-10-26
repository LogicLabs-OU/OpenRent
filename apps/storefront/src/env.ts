import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (v: string | undefined) => (v ? v : undefined);

/** Storefront runtime configuration (read when the server starts). */
export const variables = defineEnvVars({
  OPENRENT_API_URL: { schema: (v) => (v || 'http://localhost:7070').replace(/\/$/, ''), description: 'Base URL of the OpenRent API' },
  OPENRENT_STOREFRONT_DOMAIN: { schema: optional, description: 'Wildcard domain for tenant storefronts, e.g. rent.example.com' },
  TENANT_SLUG: { schema: optional, description: 'Single-shop installs: the tenant slug to serve' },
  OPENRENT_PUBLISHABLE_KEY: { schema: optional, description: 'Optional pk_ key; otherwise the tenant slug identifies the shop' },
});
