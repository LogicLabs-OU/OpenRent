import { definePlugin, type StorefrontScript } from '@openrent/plugin-sdk';

/**
 * Google Analytics 4, Meta Pixel and Plausible on the storefront (FR-SF-8). Each loads only after the
 * visitor's consent (analytics; marketing for the Pixel) and receives the storefront's events:
 * view_item, add_to_cart, begin_checkout and purchase. Set the ids of the tools the shop uses.
 */
export const SCRIPTS: StorefrontScript[] = [
  {
    src: 'https://www.googletagmanager.com/gtag/js?id={ga4_id}',
    consent: 'analytics',
    requires: 'ga4_id',
    attrs: { 'data-ga4': '{ga4_id}' },
    connect: ['https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.googletagmanager.com'],
  },
  {
    src: 'https://connect.facebook.net/en_US/fbevents.js',
    consent: 'marketing',
    requires: 'meta_pixel_id',
    attrs: { 'data-pixel': '{meta_pixel_id}' },
    connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
  },
  {
    src: '{plausible_host}/js/script.js',
    consent: 'analytics',
    requires: 'plausible_domain',
    attrs: { 'data-domain': '{plausible_domain}' },
    connect: ['{plausible_host}'],
  },
];

export default definePlugin({
  id: 'analytics',
  name: 'Analytics (GA4, Meta Pixel, Plausible)',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.7.0',
  permissions: [],
  settings: [
    { key: 'ga4_id', label: 'Google Analytics 4 measurement id', type: 'text', help: 'G-XXXXXXXXXX' },
    { key: 'meta_pixel_id', label: 'Meta Pixel id', type: 'text', help: 'Digits only; loads after marketing consent' },
    { key: 'plausible_domain', label: 'Plausible site domain', type: 'text', help: 'e.g. rent.example.com' },
    { key: 'plausible_host', label: 'Plausible address', type: 'text', help: 'https://plausible.io, or your own Plausible server' },
  ],
  setup(api) {
    api.setDefaultConfig({ plausible_host: 'https://plausible.io' });
    api.storefront({ scripts: SCRIPTS });
  },
});
