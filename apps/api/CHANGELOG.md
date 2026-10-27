# @openrent/api

## 1.0.0

### Major Changes

- OpenRent 1.0: every V1 requirement of the PRD, the REST API frozen as v1 (kept compatible by `pnpm check:api`), plugin API 1.8 and theme API 1.8.

### Minor Changes

- Helm chart (deploy/helm/openrent) with a pre-upgrade migration Job and Caddy; the API image has node dist/migrate.js.
- Managed hosting: self-serve sign-up, limits per shop (orders, storage, plugins), and the operator API to suspend, resume and erase shops.

### Patch Changes

- Security fixes from the pre-1.0 review: single sign-on limited to the provider's own shop, rate limits keyed by real credentials, network guard for outbound requests, safer file serving, one-time TOTP codes and more (docs/security/findings.md).
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @openrent/plugin-analytics@2.0.0
  - @openrent/core@2.0.0
  - @openrent/plugin-geocode-osm@2.0.0
  - @openrent/i18n@2.0.0
  - @openrent/sdk@2.0.0
  - @openrent/plugin-rates-ecb@2.0.0
  - @openrent/plugin-calendar-google@2.0.0
  - @openrent/plugin-calendar-microsoft@2.0.0
  - @openrent/plugin-notify-twilio@2.0.0
  - @openrent/plugin-notify-messagebird@2.0.0
  - @openrent/theme-sdk@2.0.0
  - @openrent/plugin-sdk@2.0.0
  - @openrent/plugin-tax-vies@2.0.0
  - @openrent/plugin-notify-slack@2.0.0
  - @openrent/db@2.0.0
  - @openrent/theme-concept@2.0.0
  - @openrent/theme-default@2.0.0
  - @openrent/theme-ink-green@2.0.0
  - @openrent/theme-linen@2.0.0
  - @openrent/theme-marquee@2.0.0
  - @openrent/theme-nightfall@2.0.0
  - @openrent/theme-retro@2.0.0
  - @openrent/plugin-host@2.0.0
  - @openrent/plugin-accounting-quickbooks@2.0.0
  - @openrent/plugin-accounting-xero@2.0.0
  - @openrent/plugin-accounting-zoho-books@2.0.0
  - @openrent/plugin-crm-hubspot@2.0.0
  - @openrent/plugin-notify-postmark@2.0.0
  - @openrent/plugin-notify-resend@2.0.0
  - @openrent/plugin-notify-smtp@2.0.0
  - @openrent/plugin-payment-mollie@2.0.0
  - @openrent/plugin-payment-paypal@2.0.0
  - @openrent/plugin-payment-stripe@2.0.0
  - @openrent/plugin-reviews-trustpilot@2.0.0
  - @openrent/plugin-search-meilisearch@2.0.0
  - @openrent/plugin-storage-s3@2.0.0
  - @openrent/plugin-tax-taxjar@2.0.0
