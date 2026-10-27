# ADR 0011: Multi-currency display, consent-aware analytics, theme hooks, and running many shops

Status: accepted

The last V1 storefront work (FR-I18N-7, FR-SF-8, FR-THM-10, FR-THM-12, FR-PR-8, FR-SF-7) and the managed cloud (PRD §10.1) touch the same boundaries: what themes and plugins may add to a shop's pages, what a shop's settings may make the server do, and what the operator controls. This records the choices.

## Multi-currency display

- **Charged in one currency.** Orders, payments, documents and the books stay in the shop's currency. Other currencies are for showing prices only, marked "≈", and never on checkout, order, account or signing pages.
- **Rates** come from the shop (typed in) or from a rates plugin (`RatesProvider`, plugin API 1.7; `rates-ecb` bundled), refreshed daily by the worker. A currency without a rate is not offered.
- **Where conversion happens:** catalogue answers carry converted price descriptions when the storefront sends `X-Display-Currency` (with `Vary`), and the runtime converts amounts it formats. Themes need no code; the switcher is a storefront-owned slot.
- **Tax display** (with or without tax) is a setting per storefront language, because it follows the customer's market, not the shop's.

## Consent-aware analytics

- **One event bus in the storefront** (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`), bridged to GA4, Meta Pixel and Plausible by the `analytics` plugin. Nothing is sent, and no analytics script loads, before the visitor allows analytics in the existing consent banner.
- **Scripts with settings:** `StorefrontScript.src` and `attrs` may name plugin settings (`{measurement_id}`). The result must be a plain https URL; data attributes are limited to safe characters; CSP origins are computed after filling.

## Theme hooks and the widget

- **Extension points are declared** in the theme manifest (`extension_points`, theme API 1.8). Plugins add home page section types (`sections` in their storefront extensions): a schema for the editor and a server-rendered snippet, cleaned like the shop's own HTML, with a two-second budget. A theme without the extension point simply does not show them.
- **The widget dresses like the live theme** from an optional `widget/widget.css` with placeholders for theme settings and branding, filled on the server with safe values only.

## Delivery by distance

- **Fees by distance bands** (`per_km`), priced from the location to the customer's address. A geocoder plugin (`Geocoder`, plugin API 1.7; `geocode-osm` bundled) finds addresses and, when it can, road distances; otherwise the straight line times a road factor.
- **Answers are cached per shop**, as public geocoding services ask, and deliveries keep their map point for routes and GPX.

## Headless storefronts

- **`@openrent/sdk/storefront`** types requests from the OpenAPI document and answers from the theme contract (`@openrent/theme-sdk/types`): storefront answers have no response schemas, so the shapes themes already rely on are the contract.
- **`create-openrent-storefront`** copies a small SvelteKit shop that works without JavaScript. It is kept in the workspace so CI typechecks and runs it end to end.

## Running many shops

- **Operator, not staff.** Limits, suspension and erasure are an operator API behind `OPENRENT_OPERATOR_KEY` (sent as `X-Operator-Key`), outside any shop. Sign-up is off unless `OPENRENT_SIGNUP=1` on a multi-shop installation, and refuses emails that already have an account.
- **Suspension keeps data** and answers "suspended" to staff and "not available" to customers; the worker pauses the shop.
- **Erasure is one transaction** on the owner connection, as the `openrent_maintenance` role, which the append-only triggers let remove rows only for the shop named in `openrent.erasing_tenant`. The legal records stay immutable for everyone else.

## What a shop's settings may make the server do

On a multi-shop installation a shop owner is untrusted towards other shops and towards the operator (see [the threat model](../security/threat-model.md)). Therefore:

- **Every outbound request a shop or customer can steer** (webhooks, imports, document resources, and on multi-shop installations every `fetch` in the API and worker) goes through one network guard that checks the connected address after DNS and on every redirect. The operator lists its own internal services in `OPENRENT_OUTBOUND_ALLOW`.
- **A shop that points a plugin at its own endpoint** gets none of the installation's default settings, so the operator's keys never travel to a host a shop chose.
- **Uploaded code plugins** are off on multi-shop installations.
- **A shop's identity provider** speaks only for that shop's people.

## Consequences

- Plugin API 1.8 and theme API 1.8 are part of the 1.0 contract.
- Single-shop installations keep their freedom: private webhook and import targets can be allowed, and code plugins can be uploaded when the operator turns it on.
