# @openrent/admin

## 1.0.0

### Minor Changes

- Delivery fees by distance bands, with OpenStreetMap geocoding (Nominatim, optional OSRM routes); deliveries keep their map point for routes and the GPX export.
- Dutch: admin, storefront, all seven themes, emails, text messages and documents.
- Managed hosting: self-serve sign-up, limits per shop (orders, storage, plugins), and the operator API to suspend, resume and erase shops.

### Patch Changes

- Security fixes from the pre-1.0 review: single sign-on limited to the provider's own shop, rate limits keyed by real credentials, network guard for outbound requests, safer file serving, one-time TOTP codes and more (docs/security/findings.md).
- Updated dependencies
  - @openrent/i18n@2.0.0
  - @openrent/ui@2.0.0
