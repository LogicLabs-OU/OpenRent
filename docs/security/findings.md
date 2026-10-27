# Security findings before 1.0

Our own review ahead of the external one, by area: authentication, outbound requests, HTML and files, isolation and secrets. Each finding has what an attacker could do, and what was done. Tests: `apps/api/test/security.test.ts`, `apps/api/test/shop-operations.test.ts`, `packages/core/test/net-guard.test.ts`.

"Multi-shop" means an installation with `OPENRENT_MODE=multi_tenant`, where a shop owner is an attacker towards other shops and towards the operator.

## Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | High | **SSO takeover across shops.** Any shop could register an OIDC provider for any email domain; its IdP could then sign in an existing user of another shop, and `enforce_sso` could lock a domain out of password sign-in installation-wide. | An identity provider signs in only people who belong to no other shop (`sso_other_shop`); "SSO required" and the sign-in buttons apply only through shops the person belongs to. |
| F2 | High | **Rate limits bypassed.** The limit key came from the raw `Authorization` header or session cookie, so a made-up header gave every request a fresh bucket (unlimited password guessing). | Limits are applied after credentials are resolved and keyed by the real API key, session or client address; failed sign-ins are also limited per email (10 in 15 minutes). |
| F3 | High | **PDF rendering reached internal hosts** through redirects from an `https:` resource in a document template (`staff` can edit templates). | Chromium fetches nothing itself: each resource is fetched through the network guard (every hop checked) and handed over. |
| F4 | High | **Plugin endpoints and the operator's keys (multi-shop).** A shop could point a plugin (`api_base_url`, `host`, OAuth URLs) at its own server and receive the installation's default keys, or at internal hosts. | A shop that sets an endpoint gets none of the installation's defaults; every `fetch` in the API and worker goes through the network guard on multi-shop installations (`OPENRENT_OUTBOUND_ALLOW` lists the operator's own services). |
| F5 | High | **SVG child-theme assets ran script on the API origin**, publicly linkable: cross-shop session riding. | Theme assets are served with `Content-Security-Policy: … sandbox`, `nosniff`, and SVGs as downloads when opened directly. |
| F6 | High | **Uploads served inline.** `purpose=import` accepted any type (e.g. HTML) and `/files/:id/content` served it inline on the admin origin. | Imports accept CSV and Excel types only; the route serves only images, photos and imports, with `nosniff`, a sandbox CSP and `attachment` for anything but raster images. |
| F7 | High | **Sign-in links readable in the message log** by any role with `orders:read` (magic links, invitations, resets, customer and signing links). | The log never shows the content of such messages (`content_hidden`). |
| F8 | Medium | **Webhooks and imports followed redirects into the internal network**; private-address checks only looked at literal hosts when the URL was saved. | Both go through the network guard (DNS answers, redirects and the connected address are checked); webhooks never follow redirects; response bodies are capped. |
| F9 | Medium | **Client address spoofable**: `TRUST_PROXY` trusted any `X-Forwarded-For`. | By default only proxies on loopback and private networks are trusted; `TRUST_PROXY` takes `true`, `false` or a list. |
| F10 | Medium | **Second factor skipped** by an emailed sign-in link and by sign-up with an existing account's password. | Links ask for the authenticator code; sign-up refuses emails that already have an account. |
| F11 | Medium | **API key scopes could exceed their creator's**, so `api_keys:manage` alone could mint a full-access key. | Scopes must be known and within the creator's permissions; the default is the creator's own. |
| F12 | Medium | **Uploaded code plugins on multi-shop installations**: any owner could run code in the shared process. | `OPENRENT_ALLOW_PLUGIN_UPLOAD` has no effect on multi-shop installations. |
| F13 | Medium | **Another shop could reset or rename a shared staff account** installation-wide. Admins could act on owners. | A shop only ends its own sessions for people who also work elsewhere and leaves their password and name alone; only owners act on owners. |
| F14 | Medium | **ZIP bomb in child-theme install** could exhaust memory. | At most 500 files and 40 MB unpacked. |
| F15 | Medium | **Login timing told which emails exist** (the dummy hash failed to decode instantly). | A real dummy hash, made once at start. |
| F16 | Low | **TOTP codes reusable** within their 90-second window. | The last used step is kept; each code works once. |
| F17 | Low | **Storefront could be framed** (clickjacking on checkout). | `frame-ancestors 'none'`. |
| F18 | Low | **Image decompression bombs.** | At most 40 megapixels per image. |
| F19 | Low | **Storefront HTML through the generic settings PATCH** skipped the cleaner. | Refused there; it goes through `PUT /storefront_code`. |
| F20 | Low | **Metrics protected by an `Authorization` header** that the API key check refused. | `X-Operator-Key`, like the operator API. |

## Open (for the external review)

| # | Severity | Finding | Plan |
|---|---|---|---|
| O1 | Medium | Inviting someone by email adds an existing account to the shop without their consent (no takeover after F1 and F13, but they receive a membership). | Pending invitations that the person accepts (M3). |
| O2 | Low | Rate limits live in each API process: with N instances they are N times higher. | A shared store (Redis or PostgreSQL) for the limiter. |
| O3 | Low | The API only warns when its database role can bypass row-level security. | Refuse to start on multi-shop installations unless explicitly allowed. |
| O4 | Low | TOTP secrets are stored unencrypted. | Seal them with the encryption key like other secrets. |
| O5 | Low | Analytics script origins are in the storefront CSP before the visitor consents (the scripts themselves load only after consent). | Add origins per consent category. |

## Accepted

- `uuid` below 11.1.1 (moderate, via `exceljs`): affects `v3`/`v5`/`v6` with a buffer argument; `exceljs` only calls `v4()`. CI fails on high and critical advisories (`pnpm audit --prod --audit-level=high`).
- Order `public_token` is stored as is: it is a capability for the customer's own confirmation page, 24 random bytes, rate limited, and redacted from exports.
- Plugins are trusted code (see the threat model).
