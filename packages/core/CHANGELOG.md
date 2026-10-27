# @openrent/core

## 1.0.0

### Minor Changes

- Delivery fees by distance bands, with OpenStreetMap geocoding (Nominatim, optional OSRM routes); deliveries keep their map point for routes and the GPX export.
- Dutch: admin, storefront, all seven themes, emails, text messages and documents.
- Managed hosting: self-serve sign-up, limits per shop (orders, storage, plugins), and the operator API to suspend, resume and erase shops.
- Prices can be shown in other currencies (rates by hand or from the ECB), marked approximate, with a switcher in the storefront; tax-inclusive or exclusive display per language. Orders are charged in the shop's currency.
- Saved and scheduled reports, bookings in Google and Microsoft calendars, SMS and WhatsApp booking updates, and imports from Booqable, Snipe-IT and Shelf.nu.

### Patch Changes

- Security fixes from the pre-1.0 review: single sign-on limited to the provider's own shop, rate limits keyed by real credentials, network guard for outbound requests, safer file serving, one-time TOTP codes and more (docs/security/findings.md).
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @openrent/i18n@2.0.0
  - @openrent/theme-sdk@2.0.0
  - @openrent/plugin-sdk@2.0.0
