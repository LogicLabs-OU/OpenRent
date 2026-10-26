# ADR 0004: Customer accounts, theme API 1.3, home page sections and calendar feeds

Status: accepted

## Customer accounts

- An account is a tenant plus a normalised email. A shop can hold several customer rows with the same email; the account sees the orders of all of them (merged and deleted rows excluded) and edits the oldest, the row checkout reuses.
- Sign-in is a one-time email link (`customer_login_tokens`, SHA-256 hashed, 15 minutes). Only emails with a booking get a link; the answer is the same either way, and the route is limited to 5 requests per 15 minutes per email.
- Opening the link shows a **Sign in** button instead of signing in on GET, so mail scanners that follow links cannot use the token up.
- Sessions (`customer_sessions`, hashed, 30 days) live in an httpOnly cookie on the storefront. The storefront server forwards the token as `X-Customer-Session`; browsers never call the account API directly, and API CORS stays credential-free.
- Staff see a customer's sessions on the customer page and can sign them out everywhere.

## Cancellation requests, not self-cancellation

- The shop owner chose that customers **ask** and staff decide. `cancellation_requests` holds at most one pending request per order (partial unique index).
- Customers may ask from the account or from the private order link (the link proves the booking), while the order can still be cancelled and pickup has not passed. They can withdraw a pending request.
- Approving runs the order's existing `cancel` action, so refunds follow the cancellation tiers (or the percentage staff enter), stock is released, invoices are voided and the customer gets `order_cancelled`. Declining sends `cancellation_declined` with the staff note.

## Documents for customers

- Customer-facing documents (everything except pick lists) are listed on the order and in the account. Downloads go through the storefront (`/order/{token}/documents/{id}` or the account) and reuse the stored PDF. Voided documents are hidden.

## Theme API 1.3

- New optional templates: `account`, `account-login` and `search`. A theme that leaves them out gets the default theme's version inside its own layout, so existing `^1.0.0` themes keep working.
- New runtime members (all optional for older storefronts): `account.*`, `url.account`, `url.accountLogin`, `url.search`, `url.document`; `shop.customer` and `shop.features`.
- Theme texts have no plural syntax; templates pick `key.one` / `key.other` with `Intl.PluralRules`.

## Home page sections

- A theme ships `sections/<type>.json` (settings and repeatable blocks) and `config/sections_data.json` (the default layout). The file name is the type.
- The shop's layout is stored per theme in `theme_sections[themeId]`; missing means the theme default. `validateSections` checks types, ids, settings and block limits and reports problems by path (`sections.2.settings.heading`), which the admin shows next to the fields.
- The home page flat settings (`hero_heading`, `feature_N_*`, `show_*`) moved into sections. Values a shop saved under the old keys are no longer read; re-enter them in Admin → Themes → Home page.
- The admin preview is an iframe on the signed preview link. Over https the preview cookie is `SameSite=None; Secure` so it works when the storefront is on another site.

## Custom code

- Tenant-wide `storefront_code` (CSS, header HTML, footer HTML) is cleaned on save: `sanitize-html` without scripts, event handlers or inline styles, links limited to https, mailto and tel; CSS loses `@import`, `</style`, `expression(` and `javascript:`. The storefront renders the stored values as they are, and the CSP is unchanged.

## Calendar feeds

- `calendar_feeds` stores a hashed token; the URL is shown once, like an API key, and can be revoked. `GET /api/v1/calendar/{token}.ics` needs no session, is limited to 60 requests per minute and covers 30 days back to 180 days ahead.
- The ICS writer is hand-written (CRLF, 75-octet folding without splitting UTF-8 characters, TEXT escaping, UTC times); no dependency.

## Test stack

- Test dev servers run with `SVELTEKIT_OUT_DIR=.svelte-kit-e2e`. Two Kit dev servers sharing one `.svelte-kit` folder reload each other's generated env modules, and the storefront then fell back to its default API URL.
