# OpenRent threat model

This document describes what OpenRent protects, from whom, and how. It is written for the external security review and for contributors who change anything on a trust boundary. Findings from our own review, and what was done about each, are in [findings.md](findings.md).

## System

| Part | Runs | Talks to |
|---|---|---|
| API (`apps/api`) | Fastify, Node 24 | PostgreSQL, object storage (S3), plugins in process, outbound HTTP for plugins and webhooks |
| Worker (`apps/worker`) | Node 24 | PostgreSQL, the same plugins, SMTP and provider APIs |
| Storefront (`apps/storefront`) | SvelteKit server | The API's public storefront namespace only (`/api/v1/storefront`, `/api/v1/portal`) |
| Admin (`apps/admin`) | Static SPA served by the API | The API with a session cookie |
| Widget (`apps/widget`) | Script on shops' own websites | The API's storefront namespace with a publishable key |
| Caddy | Reverse proxy | TLS for the platform domain and, on demand, for shops' own domains |
| PostgreSQL 16 | Database | Row-level security per shop; append-only tables enforced by triggers |

One installation serves one shop (`single_tenant`) or many (`multi_tenant`, the managed cloud). A shop is a *tenant*.

## Assets

1. **Customer personal data**: names, emails, phones, addresses, ID check results, signatures, damage photos.
2. **Money and the books**: payments, deposits (card holds), invoices, accounting entries. Issued documents and accounting entries are legal records and must never change.
3. **Shop secrets**: payment provider keys, OAuth tokens for accounting and calendars, SMTP passwords, webhook signing secrets. Stored encrypted with `OPENRENT_ENCRYPTION_KEY`.
4. **Availability**: the guarantee that a unit is never booked twice (serialised writes, see ADR 0002).
5. **The installation** on a managed cloud: other shops' data and the operator's internal network.

## Actors

| Actor | Trust | Can |
|---|---|---|
| Anonymous visitor | None | Browse storefronts, check out, open links with tokens (order, signing, cart reminder) |
| Customer with an account | Own data | Sign in by email link, see and change own bookings |
| Shop staff | Within their shop and role | Everything their permissions allow; owners manage users, plugins, themes, settings |
| API key (secret) | Within its shop and scopes | Server-to-server integration |
| Publishable key | Storefront namespace only | What a visitor can do |
| Plugin code | Installation-wide, in process | Whatever its declared permissions and scope give; uploaded code plugins are off unless `OPENRENT_ALLOW_PLUGIN_UPLOAD=true` |
| Theme code | Browser only | Runs in visitors' browsers under the storefront CSP; never on the server |
| Installation operator | Full | Holds the database, the encryption key and `OPENRENT_OPERATOR_KEY` |

On a multi-shop installation, **a shop owner is an attacker towards every other shop and towards the operator**. Owner-level features (themes, storefront HTML, plugin settings with URLs, document templates, imports) are reviewed with that in mind.

## Trust boundaries and controls

### Shop isolation
- Every table with a `tenant_id` has row-level security, re-applied after each migration (`packages/db/sql/invariants.sql`). The API runs as a role that cannot bypass it (`probeAppRole` warns at start otherwise).
- Requests run in a transaction bound to one shop (`withTenant`). Cross-shop reads (`withSystem`) are limited to credential resolution, host lookup, worker fan-out and the operator API.
- The operator API needs `X-Operator-Key` and is off unless the key is set.

### Authentication
- Staff: password (Argon2id) with optional TOTP, email magic links, or OIDC single sign-on. Sessions are random tokens stored hashed, in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` over HTTPS.
- CSRF: every state-changing request with a session cookie must carry the `X-CSRF-Token` header matching the `or_csrf` cookie (double submit).
- API keys are stored hashed; publishable keys are limited to the storefront namespace.
- Customers: email links only; the storefront server holds the customer session and forwards it.
- Rate limits on every unauthenticated and token-based endpoint, keyed by the resolved API key, session or client address (only proxies on private networks may name the client, unless `TRUST_PROXY` says otherwise), plus a per-email limit on failed sign-ins.
- A shop's identity provider signs in only that shop's people; TOTP codes work once, also after an emailed link.

### Untrusted content
- Shop-supplied HTML (product descriptions, storefront header and footer, plugin sections) is cleaned with an allow-list before it is shown; theme code runs only in the browser.
- The storefront sends a strict CSP: scripts from its own origin, plus payment providers and analytics scripts the shop turned on, the latter only after the visitor's consent.
- Document and email templates are Handlebars with escaping. Documents are rendered to PDF in headless Chromium with JavaScript off; Chromium fetches nothing itself, every resource is fetched through the network guard and handed over.
- Uploaded files are type-checked (imports: CSV and Excel only) and served with `nosniff`, a sandbox CSP, and as downloads unless they are raster images. Child-theme assets get the same headers; SVGs open as downloads.
- Message bodies that carry sign-in links or codes are never shown in the message log.

### Outbound requests
- Webhooks, import sources, document resources and, on multi-shop installations, every `fetch` in the API and worker go through the network guard (`packages/core/src/net/guard.ts`): loopback, private, link-local, CGNAT and other reserved ranges are refused when connecting, after DNS and on each redirect, against the address actually connected to. Operators list their own internal services in `OPENRENT_OUTBOUND_ALLOW`. Single-shop installations may allow private webhook and import targets (`WEBHOOKS_ALLOW_PRIVATE_NETWORK`, `IMPORTS_ALLOW_PRIVATE_NETWORK`).
- On multi-shop installations, a shop that points a plugin at its own endpoint gets none of the installation's default keys, and uploaded code plugins are off.

### Records that must not change
- Audit log, accounting entries, issued documents, inspections and signatures are append-only, enforced by database triggers. Only the `openrent_maintenance` role may remove a shop's rows, when the operator erases that shop.

### Secrets
- Plugin secrets, OAuth tokens and SMTP passwords are encrypted with AES-256-GCM under `OPENRENT_ENCRYPTION_KEY` and never returned by the API (only where each value comes from).
- Webhook payloads and audit entries never include secret values.

## Threats we accept

- **Plugins are trusted code.** A plugin runs in the API process. Only install plugins you trust; uploaded plugins are off by default. Packages are not signed: a signed public directory is deferred (ADR 0013).
- **The operator sees everything.** Whoever holds the database and the encryption key can read every shop's data.
- **Email is the customer's identity.** Whoever controls a customer's inbox can sign in as that customer.
- **Denial of service** beyond rate limits is left to the hosting layer (Caddy, a CDN, the cloud's protection).

## Where to look first

1. `apps/api/src/auth.ts`: credential resolution for every request.
2. `apps/api/src/http.ts`: the router, permissions and transactions.
3. `packages/db/sql/invariants.sql`: row-level security and append-only triggers.
4. `packages/core/src/storefront/code.ts`: HTML cleaning.
5. `apps/api/src/pdf.ts`: rendering documents in a browser.
6. `packages/core/src/webhooks`, `packages/core/src/imports/sources.ts`: outbound requests.
7. `apps/api/src/plugin-install.ts`: installing plugin and theme packages.
