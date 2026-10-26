# OpenRent

Open-source, API-first software for businesses that rent out equipment: bikes, cameras, AV gear, tools, party furniture.
Self-host it with one `docker compose up`, or run it as a multi-tenant service. Every feature is in the AGPL core; nothing is gated behind a tier.

The product requirements live in [`.dev/general/prd.md`](.dev/general/prd.md) and the market research in [`.dev/general/research.md`](.dev/general/research.md).

## Status

This is the first MVP slice: every layer of the PRD architecture works end to end, with a subset of each area.
[docs/adr/0001-session-one-scope.md](docs/adr/0001-session-one-scope.md) lists exactly what is in, what was simplified and what is next.

What works now:

- **Availability engine** enforced by PostgreSQL: an exclusion constraint makes double-booking a serialised unit impossible; bulk pools are serialised with advisory locks. Buffers, downtime, bundles, late binding of units, opening hours, blackout dates, notice and duration rules.
- **Pricing engine**: fixed, per period, tiered with caps, and price tables; non-billable weekdays; coupons; deposits; per-line tax rounded per invoice; an explanation for every price. Property-tested.
- **Order lifecycle**: draft → quote → reserved → prepared → out → returned → inspected → closed, plus cancel, expire and reopen. Scan-to-assign, partial pickup and return, late fees, inspection with damage charges, cancellation refunds by lead time.
- **Payments**: manual payments, a ledger-derived payment status, Stripe (Payment Element checkout, saved card, off-session deposit hold with manual capture, refunds, signed webhooks), and deposits through their whole lifecycle.
- **Documents**: quote, confirmation, rental agreement, pick list, invoice, credit note, receipt. Handlebars templates, gap-free invoice numbers, immutable once issued. PDFs rendered with headless Chromium, stored once and attached to emails.
- **Email**: each shop sends through SMTP, Postmark or Resend (plugins; the shop picks one), sends a test, and edits every message with a live preview. Delivered and bounced statuses come back from the provider. Sent, failed and queued messages are listed on each order.
- **Staff notifications**: a bell in the admin for new online bookings, payment problems, overdue returns, expiring deposit holds, cancellation requests, low availability (threshold per variant) and webhooks that were turned off; each member chooses what they get in the admin and by email.
- **Payments, more**: provider-hosted payment links, deposits taken as a charge and refunded, a policy for expiring card holds, damage emails with photos, and a daily reconciliation against the provider.
- **Files and data**: S3/MinIO storage (`storage-s3` plugin), attachments on orders, customers and units, custom fields with tags and rich text, a document template editor, a full data export as a ZIP built in the background, and CSV/XLSX downloads of the order and customer lists and of every report, including an availability forecast.
- **Storefront domains**: shops add their own domain, prove it with a DNS record and get a certificate from Caddy on first visit.
- **Widget checkout**: `<openrent-category>` and a booking drawer loaded on demand; online payments return to the merchant's page (allowed sites only).
- **Operations**: `openrent` CLI for migrations, backup and restore with file checksums, moving files to object storage and turning plugins off; scanner setup per device; the admin works as an offline shell (service worker).
- **Security and accessibility**: CSP in the admin (hashes) and storefront (nonces, plus each shop's payment provider and consented plugin scripts); axe checks in the end-to-end tests.
- **Shop wording**: Settings → Wording changes any text of the storefront, themes, plugins, emails and documents per language.
- **Rental operations**: price rules (seasons, weekdays, holidays, customer groups, volume, lead time), fees (delivery zones, cleaning, damage waiver with an excess, extension and late fees) offered at checkout, extensions and early returns (also requested by customers), swapping a unit mid-rental, deliveries and collections on a day board with route exports, and overbooking on purpose with a reason.
- **Several locations**: contact and tax details per location (a branch can charge its own tax and show its own tax id), a location switcher in the admin header, reports by location, stock transfers that hold stock at the source and keep it unavailable at the destination until it arrives (received by scanning or on the transfer), and availability at every location with a shortcut to plan a transfer ([ADR 0007](docs/adr/0007-availability-changes-and-transfers.md)).
- **Warehouse and quality**: repair tickets for one or more units with priority, assignee, due date, parts and cost; inspection checklists per category, run at return or from the scan page; meter readings, service intervals by days, rentals or meter (with a daily job that opens service tickets); straight-line depreciation and a book value report; a page per unit; a unit planner where bookings are dragged to another unit; scans made offline that are sent when the connection is back; and documents signed by the customer with a code sent by email.
- **Team and access**: custom roles built from a permission matrix next to the five built-in ones; members are invited, sent a sign-in link, have their password reset, or are turned off and on again; each member sets their own password. Single sign-on through any OpenID Connect provider (Google Workspace, Microsoft Entra, Okta…) per shop, with allowed email domains, a default role for new members, and sign-on that can be required for the domain.
- **Accounting**: every invoice, credit note, payment, refund and deposit becomes a balanced, numbered accounting entry that is never changed, captured by database triggers so nothing is missed; invoices can be issued automatically, and a lock date closes periods. Admin → Accounting connects Xero, QuickBooks Online or Zoho Books (plugins): pick the organisation, map accounts and tax rates from the system's own lists, choose a start date. Entries go across within a minute; payments made before the invoice are applied when it arrives; payments recorded there come back; a daily check flags anything changed there. Records show each entry's status with a link to the remote record; the journal (CSV/XLSX) serves any other software ([ADR 0009](docs/adr/0009-accounting-sync.md), [guide](docs/guide/accounting.md)).
- **Integrations**: Admin → Integrations connects other systems through plugins, by OAuth or an API key, with retries, a sync log, earlier records sent on request and a map of remote ids: HubSpot (customers become contacts, bookings become deals that follow the booking's status) and Trustpilot (a review invitation after each return) ([ADR 0008](docs/adr/0008-integrations.md)).
- **REST API** (`/api/v1`, 331 paths) with OpenAPI 3.1, Scalar docs at `/docs`, idempotency keys, ETags, RFC 9457 errors, cursor pagination and filters, rate limits, session or API-key auth, and row-level security per tenant.
- **Webhooks** from a transactional outbox, HMAC-signed, retried with backoff, auto-disabled after 3 days of failure. **Worker** with pg-boss schedules: quote expiry, reminders, overdue notices, deposit authorisation and expiry, cleanup and consistency checks.
- **Back office** (SvelteKit SPA): dashboard, orders, order hub, new order with live price and availability, products and units, inventory, customers (dedupe, merge, GDPR export and anonymise), scanning (USB/Bluetooth scanners and camera), reports with CSV export, settings.
- **Storefront** (SvelteKit SSR) rendered by an installable theme built on `@openrent/theme-sdk` (`@openrent/theme-default`, `@openrent/theme-retro`: flat black outlines, loud colours, price tags and a coin motif, `@openrent/theme-concept`: a calm document-style shop with a sidebar, page covers and icons, and gallery or table views, `@openrent/theme-ink-green`: deep green pages, lime blocks behind big serif headlines and sage panels, `@openrent/theme-marquee`: a box-office poster wall with condensed capitals, outlined titles, crop marks, ticker strips and electric blue, `@openrent/theme-linen`: calm warm greys, a bronze accent, pill navigation and panels that stack as you scroll, or `@openrent/theme-nightfall`: a dark, cinematic shop with glowing gradients, glass panels, a scroll-lit statement and a tilted product shelf): date-first catalogue, search with category, sort and free-on-my-dates filters, availability calendar, cart, checkout with terms acceptance and Stripe, confirmation with QR code and document downloads.
- **Customer accounts**: customers who have booked sign in with a one-time email link (no password) to see upcoming and past bookings, download their documents, edit their details and ask the shop to cancel. Staff approve (the order is cancelled and refunded by the cancellation tiers) or decline on the order page.
- **Themes**: Admin → Themes lists installed themes; each one has a settings form generated from its `settings_schema.json`, a home page section editor (add, order and edit sections and their items with a live preview), text overrides, a signed one-hour preview link, publish, and settings export and import. Shops can add their own CSS and header/footer HTML, cleaned on save.
- **Calendar feeds**: Settings → Calendar creates secret iCal links that show pickups and returns in Google, Apple or Outlook calendars.
- **Embeddable widget**: `<openrent-product>` and `<openrent-book-button>` custom elements built from the same shadcn components inside Shadow DOM.
- **Plugins**: Stripe, SMTP, Postmark, Resend, S3 storage, Xero, QuickBooks, Zoho Books, HubSpot, Trustpilot, TaxJar (US sales tax by address) and Meilisearch (typo-tolerant storefront search, kept up to date as products change) are plugins loaded through the same host and SDK third parties use. Admin → Plugins enables, disables and configures each plugin per shop; secret settings are encrypted. Plugins get a guarded database scope, their own tables through checked migrations, schedules, tax, identity and search providers, integrations, admin extensions, checkout fields, badges and consented scripts; owners may install them from a ZIP when the operator allows it ([ADR 0006](docs/adr/0006-plugin-and-theme-platform.md)). `create-openrent-plugin` and `@openrent/plugin-testing` help write them.
- **Child themes**: a shop uploads a theme that builds on an installed one (colours, texts, layout, CSS, images) and sees what changes before confirming; code themes go in with `openrent theme install` and a rebuild.
- **Languages**: English, German, French, Spanish, Estonian and Japanese. Each staff member picks the back office language in the user menu. A shop turns on several storefront languages (Settings → General → Languages); customers switch in the header, and other languages live under a path prefix (`/de/p/kayak`). Product, variant and category names, home page texts, theme texts, rental terms, header and footer HTML and email templates are editable per language; built-in texts, emails and documents come translated.
- **UI**: admin, storefront theme and widget use shadcn-svelte components from `packages/ui`, with all text in translation catalogues.

## Quick start (development)

Requirements: Node.js 22.12 or newer, pnpm 10, PostgreSQL 16 or newer.

```sh
pnpm install
cp .env.example .env
./scripts/gen-secrets.sh          # fills OPENRENT_ENCRYPTION_KEY and OPENRENT_SESSION_SECRET
# edit .env: set DATABASE_URL to your PostgreSQL 16 database
pnpm db:migrate
pnpm db:seed                      # demo shop; prints the owner login and API keys
pnpm dev
```

| What | URL |
| --- | --- |
| Back office | http://localhost:7071/admin (owner@example.com / openrent after seeding) |
| Storefront | http://localhost:7072 |
| API and docs | http://localhost:7070/docs |
| Widget demo | http://localhost:7073 |

Without a seed, open http://localhost:7071/admin/setup to create the owner, shop and first location.

No PostgreSQL at hand? `pnpm db:pglite` starts PGlite (Postgres in WebAssembly) on port 7432. Then use
`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7432/postgres?sslmode=disable` with `DATABASE_POOL_MAX=1` and `PGBOSS_POOL_MAX=1`.
It is in memory and single-backend, so it cannot prove concurrency behaviour; use real PostgreSQL for that.

`deploy/compose/docker-compose.dev.yml` starts PostgreSQL 16 and Mailpit if you prefer containers.

### PDFs and email

```sh
pnpm exec playwright install chromium     # once, for document PDFs
docker compose -f deploy/compose/docker-compose.dev.yml up -d mailpit
```

Set `SMTP_URL=smtp://localhost:1025` in `.env` (or enter a server in Settings → Email) and open http://localhost:8025 to read outgoing mail. The worker (`pnpm dev` starts it) sends queued messages.

### Database changes

The schema lives in `packages/db/src/schema.ts` (Drizzle). Change it, then:

```sh
pnpm db:generate --name what_changed   # writes a timestamped SQL migration
pnpm db:migrate                        # applies it, then re-applies packages/db/sql/invariants.sql
```

Never write migration files by hand. The invariants script enables row-level security, the tenant policy and grants on every table with a `tenant_id`, so new tables are isolated automatically. Generated migrations are forward-only.

### Translations

Every catalogue (`apps/admin/src/lib/i18n`, `packages/core/src/i18n`, `apps/storefront/src/lib/i18n`, `apps/widget/src/i18n`, each theme's `locales/`) has an `en.json` and one file per other language. English is the source and the fallback for missing keys. The non-English files start with `"_meta": { "machine_draft": true }`: they are machine drafts waiting for a native review.

```sh
pnpm check:i18n    # same keys, placeholders and plural forms in every language; runs in CI
```

A new language is a code in `packages/i18n/src/index.ts`, a file next to each `en.json`, and the new file added to `themeCatalogs({...})` in each theme's `index.ts`.

### Stripe in test mode

1. Put `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` in `.env` (or enter them in Settings → Payments).
2. `stripe listen --forward-to localhost:7070/webhooks/stripe/<tenant_id>` and copy the `whsec_` secret into `STRIPE_WEBHOOK_SECRET`. The tenant id is shown in Settings → Payments.
3. In Settings → Payments set “Payment at checkout” to Stripe. Pay with card `4242 4242 4242 4242`.

The rental is charged at checkout and the card is saved. When the customer returns from the payment page the storefront asks Stripe for the result, so the booking confirms even before the webhook arrives; an unpaid order shows a “Pay” button on its confirmation page; the deposit is held off-session with manual capture one day before pickup (Stripe holds last about 7 days) and captured or released from the order page.

## Tests

```sh
pnpm test                         # unit and property tests (pricing, availability sweep, state machine, plugins, SDK)
DATABASE_URL_TEST=postgres://…/openrent_test pnpm test:integration   # wipes that database; name must contain "test"
TEST_PGLITE=1 pnpm test:integration                                   # same suite on in-process PGlite
pnpm e2e                          # Playwright against running dev servers (after pnpm db:seed)
pnpm typecheck && pnpm lint
```

The integration suite covers setup, the full order lifecycle over HTTP, RLS isolation between tenants, CSRF, API-key scopes,
idempotent replays, ETags, the exclusion constraint, **100 parallel checkouts for the last unit with exactly one winner**,
bulk pools under parallel load, storefront checkout, signed webhook delivery, immutable gap-free invoices, the append-only audit log,
customer sign-in and cancellation requests, catalogue search, the custom code cleaner, home page sections, iCal feeds,
and the admin, storefront, emails and documents in several languages.
`pnpm e2e` signs the staff owner in once per run (`e2e/global-setup.ts`) and reuses that session, so a run stays under the login rate limit. On a test database reused across runs, set `E2E_CLEANUP=1`: the setup then cancels the open orders earlier runs left, so their bookings do not use up the stock later runs need. Never set it against a shop with real orders.

## Production

```sh
cp .env.example .env && ./scripts/gen-secrets.sh
docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --build
```

Five containers: Caddy (TLS and routing), `api` (also serves the back office and widget), `worker`, `storefront`, PostgreSQL 16.
The API applies migrations on start (`AUTO_MIGRATE=false` to turn off). Then open `/admin/setup`.

### Backups and the `openrent` CLI

The worker image includes the `openrent` command and the PostgreSQL 16 client tools:

```sh
docker compose exec worker openrent backup --out /backups/2026-10-25 --with-files
docker compose exec worker openrent restore /backups/2026-10-25 --check   # only check stored files
docker compose exec worker openrent restore /backups/2026-10-25 --yes     # replace the database
docker compose exec worker openrent files migrate-storage                 # move files from the database to S3/MinIO
docker compose exec worker openrent plugin disable payment-stripe         # for every shop, or --tenant ID
```

A backup is a `pg_dump` plus `manifest.json` with every stored file's checksum; `--with-files` also copies the files kept in object storage. Restore checks the dump against the manifest, runs newer migrations, then checks each file and puts back missing objects from the copies. In a checkout, run the same commands with `pnpm openrent …`.

Each shop can also download all of its own data: Settings → General → Export all data builds a ZIP in the worker (every table as CSV and NDJSON, issued documents as HTML, uploaded files; passwords, keys and token hashes left out).

## Repository layout

```text
apps/
  api/          Fastify REST API, OpenAPI, auth, RLS transactions, inbound provider webhooks
  worker/       outbox publisher, webhook delivery, email sending, background jobs (exports), pg-boss schedules
  admin/        SvelteKit back office (SPA under /admin)
  storefront/   SvelteKit SSR storefront and theme runtime
  widget/       Svelte custom elements bundle
packages/
  core/         domain services: catalog, inventory, availability, pricing, orders, payments, documents, …
  i18n/         the language list, Accept-Language matching and the message formatter shared by every app
  cli/          `openrent` operator commands: migrate, backup, restore, files, plugin
  db/           SQL migrations (constraints, triggers, RLS), client, migrator, demo seed, PGlite dev server
  plugin-sdk/   plugin contract (Apache-2.0)        plugin-host/  loader, compat checks, hook isolation
  plugins/      payment-stripe, notify-smtp, notify-postmark, notify-resend, storage-s3, accounting-xero, accounting-quickbooks,
                accounting-zoho-books, crm-hubspot, reviews-trustpilot, tax-taxjar, search-meilisearch
  plugin-testing/  a throwaway shop for plugin tests   create-openrent-plugin/, create-openrent-theme/  scaffolders
  theme-sdk/    theme contract (Apache-2.0)
  themes/       default, retro, concept, ink-green: the bundled storefront themes, one package each
  sdk/          generated TypeScript client and webhook verifier (Apache-2.0)
  api-spec/     generated openapi.json               ui/ shadcn-svelte components, theme CSS and OpenRent helpers
deploy/compose/ docker-compose.yml, Caddyfile        e2e/ Playwright tests        docs/adr/ decisions
```

## API in brief

- Base path `/api/v1`. JSON, `snake_case`, money as `{"amount": 2500, "currency": "EUR"}` in minor units, ISO 8601 times.
- Auth: session cookie plus `X-CSRF-Token` (back office), `Authorization: Bearer sk_…` (integrations), `pk_…` or `X-Tenant-Slug` for `/api/v1/storefront/*`.
- State changes are actions: `POST /orders/{id}/actions/reserve`, `…/check_out`, `…/check_in`. Invalid ones return `409 invalid_transition`.
- Every `POST` accepts `Idempotency-Key`. Orders return an `ETag`; send `If-Match` to avoid lost updates.
- Lists: `?limit=&cursor=&sort=-created_at&q=&filter[status]=reserved,out&filter[starts_at][gte]=2026-11-01`.
- Webhook deliveries carry `OpenRent-Signature: t=…,v1=…` (HMAC-SHA256 of `t.body`); verify with `verifyWebhook` from `@openrent/sdk`.

`pnpm openapi` regenerates `packages/api-spec/openapi.json` and the SDK types.

## Licences

The server, back office, storefront and core packages are AGPL-3.0-only ([LICENSE](LICENSE)).
The SDK, plugin SDK, theme SDK, API spec and widget are Apache-2.0, so merchants and plugin or theme authors take on no AGPL obligations.
The default theme is MIT. Contributions are accepted under the Developer Certificate of Origin; see [CONTRIBUTING.md](CONTRIBUTING.md).
