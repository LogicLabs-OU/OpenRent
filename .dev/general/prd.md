# OpenRent — Product Requirements Document

Oct 24, 2026 · @Wei Sheng

## 1. Overview

OpenRent is an open-source, API-first management platform for businesses that rent out physical equipment (bikes, cameras, AV gear, tools, party equipment, sports gear). It replaces Booqable-class SaaS with a self-hostable system where every operation is available through a public API, the back office and storefront are thin clients of that API, and no feature is gated behind a tier.

### 1.1 Vision

The default open-source operating system for equipment rental: as easy to start with as Booqable, as correct as a database-backed ledger, and owned by the people who run it.

### 1.2 Goals (first 18 months)

1. A single-location shop goes from `docker compose up` to its first paid online booking in under 60 minutes.
2. Zero double-bookings: a serialised unit can never be allocated twice for overlapping periods, and a bulk pool can never be oversold. The guarantee is enforced in PostgreSQL, not only in application code.
3. Feature parity with Booqable "Grow" in the core (API, e-signature, downtime, barcodes, roles and permissions, multi-location) at zero licence cost.
4. 100% API coverage: anything a user can do in the UI can be done through a documented REST endpoint, and the UI itself uses only those endpoints.
5. A theme system and a plugin system, present from the first commit, that let third-party developers ship storefront themes (as on Shopify) and plugins (as on WordPress) without forking the core.

### 1.3 Non-goals (v1)

- Real-estate, vacation or property rental.
- Vehicle-fleet contracts (licensing, mileage, insurance claims) beyond generic per-unit tracking.
- Full ERP functions: general ledger, payroll, purchasing. OpenRent integrates with accounting systems instead.
- Crew or labour scheduling (planned as a plugin after v1).
- A drag-and-drop website builder. OpenRent ships a themeable hosted storefront, an embeddable widget and a headless API instead.
- Peer-to-peer marketplace features (listings by many independent owners with payouts).

### 1.4 Competitive positioning

| Against | OpenRent position |
| --- | --- |
| Booqable | Same ease of start; no tier gating; checkout on the merchant's own domain; self-host or managed cloud; data export at any time |
| Rentman, Current RMS, HireHop | Not competing on crew and project depth at launch; compete on cost, openness, storefront and API |
| Quipli, Point of Rental | Lower cost of entry; fleet and inspection features through plugins |
| Louez, AdamRMS (open source) | Differentiate on the DB-enforced availability engine, bulk + serialised + bundle model, barcode warehouse workflows, deposit lifecycle and a public plugin API |
| Snipe-IT, Shelf.nu | Complementary. They track owned assets; OpenRent runs a rental business (pricing, payments, customers). Provide importers |

### 1.5 Glossary

| Term | Meaning |
| --- | --- |
| Tenant | One rental business (company) inside an OpenRent installation. All data is scoped by `tenant_id` |
| Location | A physical place where stock is kept and orders are picked up or returned |
| Product | A rentable or sellable catalogue entry shown to customers (e.g. "Canon R5 body") |
| Variant | A sub-type of a product with its own stock (e.g. bike size M vs L) |
| Stock item | One physical, serialised unit of a product variant with its own barcode and condition |
| Stock level | The quantity of a bulk (non-serialised) product variant at a location |
| Bundle | A product composed of other products (fixed or with choices) |
| Allocation | A claim on stock for a time range: a reservation line, a maintenance block or a buffer |
| Buffer | Turnaround time blocked before and/or after a rental for cleaning, charging or inspection |
| Order | The commercial document that moves through quote, reservation, pickup, return and closing |
| Late binding | Reserving a quantity of a product and assigning specific stock items only at preparation or pickup |
| Deposit | A refundable security amount held by card pre-authorisation or charge |

## 2. Product principles

These principles decide trade-offs. When two requirements conflict, the earlier principle wins.

1. **API first.** Every operation exists as a versioned REST endpoint before it exists in any UI. The back office (SvelteKit) and the storefront call the same public API with the same auth model. No endpoint is "internal only". A feature with no API is not done.
2. **Correctness over convenience.** Availability, money and documents are the ledger of the business. Invariants (no double-booking, no negative stock, immutable issued invoices, snapshot pricing on orders) are enforced by database constraints and transactions, with application checks as a second layer.
3. **Self-hosting is a first-class target.** One `docker compose up` gives a complete, production-capable instance. No feature requires a hosted service we run. Hosted/managed cloud is a deployment of the same code with multi-tenancy enabled.
4. **No tier gating.** All features ship in the AGPL core. Monetisation (if any) is hosting, support and services, never feature flags.
5. **Themes and plugins are in the DNA, not bolted on.** The storefront is rendered by an installable theme (uploaded ZIP or a package in `THEMES_DIR`) and the core exposes hooks, providers and UI slots for installable plugins. Core features themselves are built through the same theme and plugin APIs, so the APIs are proven before third parties use them (see 3.16, 3.17, 7.9).
6. **Boring, observable operations.** PostgreSQL as the single system of record; background jobs in Postgres (no extra broker for the default install); structured logs, metrics and traces via OpenTelemetry.
7. **Fast for the counter.** The back office is optimised for staff under time pressure: keyboard-first, barcode-scan-first, two clicks from search to check-out.
8. **Privacy and data ownership.** Full data export (JSON + CSV + documents) at any time; GDPR erasure; no telemetry without opt-in.
9. **Localised by default.** Every user-facing string, date, number, currency and document template is translatable; the UI ships in English, Dutch, German, French, Spanish and Estonian at 1.0.
10. **Accessible.** WCAG 2.2 AA for both back office and storefront.

## 3. Functional requirements

Requirements are tagged by release: **MVP** (needed to run one shop end to end), **V1** (parity with Booqable Grow/Scale), **Later**, **Deferred** (not planned for now; kept for a later decision). Each area lists behaviour, rules and acceptance criteria. Every requirement implies a corresponding API endpoint (Section 5) and, where state changes, a webhook event (Section 6).

### 3.1 Tenancy, locations, users and roles

| ID | Release | Requirement |
| --- | --- | --- |
| FR-TEN-1 | MVP | An installation hosts one or many tenants. Every table carries `tenant_id`; PostgreSQL row-level security enforces isolation. Single-tenant installs still have exactly one tenant row |
| FR-TEN-2 | MVP | Tenant settings: legal name, address, tax IDs, base currency, timezone, locale, invoice numbering scheme, default terms, opening hours, branding (logo, colours) |
| FR-LOC-1 | MVP | One or more locations per tenant, each with address, timezone, opening hours and blackout dates. Stock and orders belong to a location. Single-location tenants see no location pickers |
| FR-LOC-2 | V1 | Stock transfers between locations with in-transit state; cross-location availability queries |
| FR-USR-1 | MVP | Users log in with email + password (Argon2id) or magic link; optional TOTP 2FA; sessions revocable |
| FR-USR-2 | MVP | Fixed roles: Owner, Admin, Staff, Warehouse, Read-only. Permission matrix documented per endpoint |
| FR-USR-3 | V1 | Custom roles built from granular permissions (`orders.write`, `payments.refund`, `settings.*`) |
| FR-USR-4 | V1 | OIDC single sign-on; SCIM later |
| FR-AUD-1 | MVP | Append-only audit log of every mutation: actor (user, API key, system), entity, before/after diff, IP, timestamp. Viewable per entity and globally; exportable |

### 3.2 Catalogue and inventory

| ID | Release | Requirement |
| --- | --- | --- |
| FR-CAT-1 | MVP | Product types: `rental`, `sale`, `service`, `consumable`. Products have name, slug, description (rich text), images, categories, tags, SEO fields, custom fields, visibility (public/hidden/archived) |
| FR-CAT-2 | MVP | Variants with independent stock and optional price overrides; variant options (size, colour) |
| FR-CAT-3 | MVP | Tracking mode per variant: `serialized` (each unit is a stock item with barcode/serial) or `bulk` (quantity per location). Mode can only change when no open allocations exist |
| FR-CAT-4 | MVP | Stock items: barcode (auto or imported), serial number, location, status (`available`, `reserved`, `out`, `needs_inspection`, `soft_down`, `hard_down`, `retired`, `lost`), condition grade, purchase date/price, notes, photos, custom fields |
| FR-CAT-5 | MVP | Fixed bundles: a product made of component variants with quantities. Bundle availability = min over components of floor(available/qty). Booking a bundle expands into component allocations in one transaction |
| FR-CAT-6 | V1 | Choice bundles: a component slot with selectable alternatives ("pick one lens") |
| FR-CAT-7 | V1 | Accessories and cross-sell relations; "often rented with" |
| FR-CAT-8 | MVP | CSV/XLSX import and export of products, variants, stock items and prices with a dry-run validation report |
| FR-CAT-9 | V1 | Sub-rental / temporary stock: add external units for a date range to raise capacity |
| FR-CAT-10 | V1 | Meter readings per stock item (hours, km) and depreciation schedule |
| FR-CAT-11 | Later | Containers/cases: a stock item that physically holds other stock items (AV flight cases) |

### 3.3 Availability engine

| ID | Release | Requirement |
| --- | --- | --- |
| FR-AV-1 | MVP | For any variant, location and `[start, end)` range: `available = capacity − overlapping allocations (incl. buffers) − downtime`. Serialised capacity = count of non-retired stock items; bulk capacity = stock level |
| FR-AV-2 | MVP | No double-booking: a serialised stock item cannot have two overlapping allocations. Enforced with a PostgreSQL exclusion constraint on `(stock_item_id, period)`. Bulk pools are checked inside a serialisable transaction |
| FR-AV-3 | MVP | Buffers: `buffer_before` and `buffer_after` (minutes) per variant, overridable per order line. Buffers extend the allocation period and are counted in availability |
| FR-AV-4 | MVP | Constraints per variant: min/max duration, minimum notice, increments (e.g. whole days, 30-min slots), allowed pickup/return hours from location opening hours, blackout dates |
| FR-AV-5 | MVP | Downtime blocks (maintenance, internal use) reduce availability; created manually or by maintenance tickets |
| FR-AV-6 | MVP | Late binding: orders reserve quantity against a variant; stock items are assigned at preparation/pickup. Optional early pin of a specific unit |
| FR-AV-7 | MVP | Batch availability API: up to 100 variants × one range, or one variant × a calendar month, in one request. Used by the storefront calendar |
| FR-AV-8 | V1 | Controlled overbooking: Admin may approve an allocation beyond capacity with a reason; flagged in the planner until resolved (sub-rental, swap or cancellation) |
| FR-AV-9 | V1 | Unit timeline (Gantt) view with drag-to-reassign and shortage highlighting |
| FR-AV-10 | MVP | Concurrency: 100 parallel checkout attempts for the last unit yield exactly one success. Covered by an automated test |

### 3.4 Pricing

| ID | Release | Requirement |
| --- | --- | --- |
| FR-PR-1 | MVP | Price structures per variant: `fixed` (per rental), `per_period` with period unit (hour, day, week, month) and rounding rule, `tiered` (day 1 = 100%, days 2–3 = 50%, week = 4× day), and `custom_table` (explicit price per duration) |
| FR-PR-2 | MVP | Charge days vs calendar days: configurable non-billable pickup/return days and weekend rules |
| FR-PR-3 | MVP | Tax profiles with multiple rates; prices stored tax-exclusive, displayed inclusive or exclusive per tenant setting; tax calculated per line and rounded per invoice per legal requirement |
| FR-PR-4 | MVP | Coupons: percentage or fixed, scope (order, category, product), validity window, usage limits, minimum order, combinable flag |
| FR-PR-5 | MVP | Deterministic `price-quote` endpoint: inputs (lines, dates, location, customer, coupons) → full breakdown (base, discounts, fees, deposit, tax, total). Same function used by storefront, back office and order creation |
| FR-PR-6 | MVP | Price snapshot: every order line stores the computed prices and the rule IDs that produced them. Later rule changes never alter existing orders |
| FR-PR-7 | V1 | Price rules: seasonal (date ranges), weekday/weekend multipliers, holiday calendars, customer-group price lists, volume discounts, early-bird/last-minute |
| FR-PR-8 | V1 | Fees: late return fee (per period), extension pricing, damage waiver (% of rental), delivery fee (flat, zone, distance), cleaning fee |
| FR-PR-9 | Later | Dynamic pricing suggestions from utilisation |

### 3.5 Order lifecycle

&#91;embedded content: order state machine · 11 states\]

Forward transitions run left to right; a quote that passes its TTL expires, a return can be partial before it is complete, and any order before pickup can be cancelled.

| ID | Release | Requirement |
| --- | --- | --- |
| FR-OR-1 | MVP | Statuses: `draft`, `quote`, `reserved`, `prepared`, `out`, `returned_partial`, `returned`, `inspected`, `closed`, `cancelled`, `expired`. Transitions are explicit API actions with guards; invalid transitions return `409 invalid_transition` |
| FR-OR-2 | MVP | Lines: rental lines (variant, qty, period, unit assignments), sale lines, service lines, fee lines, discount lines. Each line stores its price snapshot |
| FR-OR-3 | MVP | `draft` holds no stock. `quote` optionally holds stock for a configurable TTL (default 48 h) and then expires. `reserved` holds stock firmly |
| FR-OR-4 | MVP | Preparation: pick list grouped by location/zone; scan units to assign; warns on wrong product, wrong location, unit not available or needs inspection |
| FR-OR-5 | MVP | Pickup (check-out): scan all assigned units or confirm bulk quantities; capture signature; order → `out`. Partial pickup allowed with remaining lines flagged |
| FR-OR-6 | MVP | Return (check-in): scan units; per unit mark `ok`, `needs_inspection`, `damaged`, `lost`; partial return supported; late return computes late fees; order → `returned_partial` / `returned` |
| FR-OR-7 | MVP | Inspection step records condition, photos and damage charges; creates maintenance tickets for `soft_down`/`hard_down` units |
| FR-OR-8 | MVP | Cancellation with policy: refund rules by lead time; releases allocations; emits credit note if invoiced |
| FR-OR-9 | V1 | Extensions and early returns reprice automatically with a proposed adjustment the staff confirms |
| FR-OR-10 | V1 | Unit swap mid-rental (defective unit) keeping one order and one invoice trail |
| FR-OR-11 | V1 | Recurring/long-term rentals with periodic billing (monthly invoice while `out`) |
| FR-OR-12 | V1 | Delivery and collection: addresses, time windows, driver assignment, route export (CSV/GPX), proof of delivery photo |
| FR-OR-13 | MVP | Order notes (internal/customer-visible), tags, custom fields, attachments, full activity timeline |

### 3.6 Customers

| ID | Release | Requirement |
| --- | --- | --- |
| FR-CUS-1 | MVP | Customer types: person, company (with multiple contacts). Fields: names, emails, phones, billing/shipping addresses, tax ID, language, tags, notes, custom fields, marketing consent |
| FR-CUS-2 | MVP | Customer history: orders, payments, documents, damage incidents, lifetime value |
| FR-CUS-3 | MVP | Flags: `blocked` (cannot book online), `deposit_waived`, `requires_id_check` |
| FR-CUS-4 | MVP | GDPR: export all data for a customer; anonymise on request while keeping financial records |
| FR-CUS-5 | MVP | Dedup on email/phone with merge tool |
| FR-CUS-6 | V1 | Customer portal (passwordless link or account): view orders, documents, pay balance, request extension, update details |
| FR-CUS-7 | V1 | B2B: on-account billing, PO number field, credit limit, payment terms, consolidated monthly invoice |

### 3.7 Documents and e-signature

| ID | Release | Requirement |
| --- | --- | --- |
| FR-DOC-1 | MVP | Document types: quote, order confirmation, rental agreement/contract, pick list, delivery note, invoice, credit note, receipt, deposit receipt |
| FR-DOC-2 | MVP | Templates in Handlebars-style markup with tenant branding, per-language variants, live preview; rendered server-side to PDF (Chromium via Playwright) and HTML |
| FR-DOC-3 | MVP | Invoices and credit notes are immutable once issued, carry a gap-free sequential number per tenant per year (configurable prefix), and are stored as PDF + structured JSON |
| FR-DOC-4 | MVP | Terms acceptance: click-to-accept at checkout with timestamp, IP, user agent and hash of the accepted text |
| FR-DOC-5 | V1 | Built-in e-signature: drawn or typed signature, signer identity (name, email, OTP verification), SHA-256 of document, timestamp, IP; signature page appended to the PDF |
| FR-DOC-6 | Later | External e-sign (Documenso, DocuSign) and e-invoicing (Peppol UBL, Factur-X/ZUGFeRD, Estonian e-arve) via plugins |

### 3.8 Payments, deposits and damage

| ID | Release | Requirement |
| --- | --- | --- |
| FR-PAY-1 | MVP | Provider abstraction: `authorize`, `capture(amount)`, `void`, `refund(amount)`, `createPaymentLink`, `handleWebhook`. Stripe is the reference implementation; Mollie, PayPal, Adyen, Square in V1 as plugins |
| FR-PAY-2 | MVP | Payment intents linked to orders: full payment, down payment (% or fixed), balance due; manual payments (cash, bank transfer, card terminal) recorded by staff |
| FR-PAY-3 | MVP | Payment status on order: `unpaid`, `partially_paid`, `paid`, `refunded`, `overdue` derived from ledger entries, never edited by hand |
| FR-PAY-4 | MVP | Deposits: per order (fixed or % of rental total) and per product (summed). Methods: card pre-authorisation, charge-and-refund, cash. Lifecycle `pending → held → partially_captured → captured → released → expired` |
| FR-PAY-5 | MVP | Authorisation expiry handling: tenant policy chooses re-authorise, convert to charge, or notify staff N days before expiry (provider limits recorded per provider) |
| FR-PAY-6 | MVP | Damage: inspection creates damage charges (line items) that can be captured from the deposit, invoiced separately, or waived; photos and notes attached; customer notified |
| FR-PAY-7 | MVP | Idempotency on all payment mutations; provider webhooks reconciled by provider event ID; a daily reconciliation job flags mismatches |
| FR-PAY-8 | V1 | Damage waiver product and insurance-document upload |
| FR-PAY-9 | Later | ID / driving-licence verification (Stripe Identity, Veriff) as plugin |

### 3.9 Storefront and embeddable widget

| ID | Release | Requirement |
| --- | --- | --- |
| FR-SF-1 | MVP | Hosted storefront per tenant at `{slug}.{host}` or custom domain: catalogue, search/filters, product page with calendar and live price, cart, checkout (customer details, terms, payment), confirmation with QR code |
| FR-SF-2 | MVP | Embeddable widget (Web Components, < 60 KB gzipped initial) for a single product, a category or a "book now" button, dropping into WordPress, Squarespace, Webflow or any HTML page. Checkout completes on the merchant's domain |
| FR-SF-3 | MVP | Storefront uses only the public API with a publishable key; checkout sessions are server-created and short-lived |
| FR-SF-4 | MVP | Themes: tokens (colours, fonts, radius) editable in back office; custom CSS; header/footer HTML blocks |
| FR-SF-5 | MVP | Date/time picker respects opening hours, blackout, min notice and increments; shows unavailable dates; mobile-first |
| FR-SF-6 | MVP | Multi-language storefront with per-language product content; prices in tenant currency |
| FR-SF-7 | V1 | Headless starter (SvelteKit) and typed SDK; WordPress plugin; Shopify app |
| FR-SF-8 | V1 | Analytics hooks (GA4, Meta Pixel, Plausible) via a consent-aware event bus |
| FR-SF-9 | V1 | Guest checkout and account creation; saved customers; abandoned-cart email |

### 3.10 Barcode, scanning and warehouse

| ID | Release | Requirement |
| --- | --- | --- |
| FR-SCAN-1 | MVP | Generate Code 128 and QR labels per stock item and per bulk variant; printable sheets (Avery/Dymo/Brother sizes) and ZPL export |
| FR-SCAN-2 | MVP | Scan input from USB/Bluetooth HID scanners (keyboard wedge, with prefix/suffix detection) and from the device camera (PWA, BarcodeDetector with ZXing fallback) |
| FR-SCAN-3 | MVP | Scan modes: lookup, prepare (assign to order), check-out, check-in, stock take. Audible/visual feedback; error on wrong item |
| FR-SCAN-4 | MVP | Order QR on confirmation email/PDF opens the order on scan |
| FR-SCAN-5 | V1 | Offline queue: scans stored locally when offline and replayed on reconnect with conflict report |
| FR-SCAN-6 | V1 | Stock take: scan a location, list missing/unexpected units, mark lost |
| FR-SCAN-7 | Later | RFID (UHF) reader integration |

### 3.11 Maintenance and condition

| ID | Release | Requirement |
| --- | --- | --- |
| FR-MNT-1 | MVP | Stock item status changes with reason; `soft_down`/`hard_down` create a downtime allocation |
| FR-MNT-2 | V1 | Maintenance tickets: title, unit(s), priority, assignee, due date, cost, parts, notes, photos, resolution; linked downtime auto-released on close |
| FR-MNT-3 | V1 | Inspection checklists per category (e.g. e-bike: brakes, battery, lights) run at check-in or on schedule; results stored per unit |
| FR-MNT-4 | V1 | Service intervals by elapsed days, rental count or meter value; upcoming service list |
| FR-MNT-5 | Later | Electrical test (PAT) records and certificates |

### 3.12 Notifications

| ID | Release | Requirement |
| --- | --- | --- |
| FR-NOT-1 | MVP | Transactional email via SMTP or provider plugin (Postmark, SES, Resend): order confirmed, quote sent, payment received, pickup reminder (T-24h), return reminder (T-24h), overdue, deposit released, document signed |
| FR-NOT-2 | MVP | Templates editable per tenant and language with variables and preview; test send |
| FR-NOT-3 | MVP | Staff notifications in-app and by email: new online order, payment failed, overdue return, low availability |
| FR-NOT-4 | V1 | SMS/WhatsApp via plugins (Twilio, MessageBird) |
| FR-NOT-5 | MVP | Every outgoing message logged with status (queued, sent, delivered, bounced) and visible on the order |

### 3.13 Reporting

| ID | Release | Requirement |
| --- | --- | --- |
| FR-REP-1 | MVP | Dashboard: today's pickups/returns, overdue, revenue MTD, utilisation, open quotes |
| FR-REP-2 | MVP | Reports: revenue by period/product/category/location, utilisation per variant, availability forecast, fulfilment (on-time pickups/returns), overdue, deposits held, tax summary, coupon usage. All exportable CSV/XLSX |
| FR-REP-3 | V1 | Customer value, product ROI (revenue vs purchase price), damage frequency, staff activity |
| FR-REP-4 | V1 | Saved report filters and scheduled email delivery |
| FR-REP-5 | Later | Read-only SQL/BI connector views |

### 3.14 Integrations and extensibility

| ID | Release | Requirement |
| --- | --- | --- |
| FR-INT-1 | MVP | REST API + webhooks (Sections 5, 6); OpenAPI 3.1 spec served at `/api/v1/openapi.json`; generated TypeScript SDK |
| FR-INT-2 | MVP | iCal feeds per location and per unit; CSV export everywhere |
| FR-INT-3 | V1 | Accounting sync: Xero and QuickBooks Online (invoices, payments, contacts); generic journal CSV export |
| FR-INT-4 | V1 | Google / Microsoft calendar push of pickups and returns |
| FR-INT-5 | V1 | Zapier/n8n via webhooks + API key |
| FR-INT-6 | V1 | Plugin system summary (full requirements in 3.17): server-side hooks (`order.beforeTransition`, `price.afterCalculate`, `document.render`), provider interfaces (payment, tax, notification, storage), UI slots (order sidebar, product tab, settings page), custom entities via custom fields. Plugins are npm packages loaded from a configured directory, declared in `plugins.json`, with semver compatibility ranges |
| FR-INT-7 | V1 | Plugin sandbox: plugins run in-process but receive a scoped service context; failures in a plugin never block core transitions (logged and surfaced) |

### 3.15 Data import/export and migration

| ID | Release | Requirement |
| --- | --- | --- |
| FR-MIG-1 | MVP | Full tenant export: JSON (all entities) + CSV + documents ZIP, downloadable or to S3 |
| FR-MIG-2 | V1 | Importers: Booqable (via API), Snipe-IT, Shelf.nu, generic CSV mapping wizard |

### 3.16 Theme system (storefront)

The storefront is theme-driven in the Shopify sense: a theme is a self-contained package that owns layout, templates, sections and styling, developed separately by designers or agencies and installed by the tenant. The core ships one default theme (`@openrent/theme-default`) built with exactly the same APIs.

| ID | Release | Requirement |
| --- | --- | --- |
| FR-THM-1 | MVP | Theme package format: `theme.json` manifest (id, name, version, author, license, `compat` range of the theme API, supported locales, settings schema, preview images), `layouts/`, `templates/` (index, collection, product, cart, checkout, order-confirmation, account, page, 404), `sections/` (reusable blocks with settings), `snippets/`, `assets/` (CSS, JS, images, fonts), `locales/*.json` (theme strings), `config/settings_schema.json` and `config/settings_data.json` |
| FR-THM-2 | MVP | Templates are Svelte components compiled server-side by the storefront runtime, receiving typed data objects from the storefront API (`product`, `collection`, `cart`, `availability`, `price_quote`, `tenant`, `locale`). A theme never calls the API directly; the runtime does, so themes stay portable across versions |
| FR-THM-3 | MVP | Install themes by uploading a ZIP in Settings → Themes or by placing them in `THEMES_DIR` (self-hosters); installing from a public directory is deferred (FR-THM-11). Multiple themes can be installed; exactly one is live; any can be previewed with a signed preview URL before publishing |
| FR-THM-4 | MVP | Theme settings UI generated from `settings_schema.json` (colour, font, image, text, select, range, checkbox, link, product/collection picker); settings saved per tenant per theme; export/import of settings |
| FR-THM-5 | MVP | Section-based pages: themes declare sections and blocks; tenants reorder, add and remove sections on the home page and custom pages through a visual editor with live preview (JSON-schema driven, as Shopify Online Store 2.0) |
| FR-THM-6 | MVP | Theme translations: `locales/en.json` etc. merged with core storefront strings; tenants override any string in the Translations editor; missing keys fall back to the theme default locale, then to English |
| FR-THM-7 | MVP | Sandboxing: theme JS runs in the browser only; server-side templates have no filesystem, network or database access and receive only the typed data objects; theme assets are served from `/themes/{id}/assets/` with content hashing and long cache headers; CSP forbids inline scripts outside the theme bundle |
| FR-THM-8 | MVP | Versioning and upgrades: theme API is semver'd (`theme-api: 1.x`); installing a theme outside the compat range is refused with a clear message; theme updates keep tenant settings and show a diff of changed templates before applying |
| FR-THM-9 | MVP | Theme developer kit: `create-openrent-theme` scaffold, `openrent theme dev` local preview against any API with hot reload and mock or live tenant data, `openrent theme check` (lint, schema validation, required templates, accessibility and performance budget), `openrent theme pack` to produce the ZIP |
| FR-THM-10 | V1 | Widget theming: the embeddable widget reads the live theme's tokens and a `widget/` template group so it matches the merchant site |
| FR-THM-11 | Deferred | Public theme directory (`themes.openrent.dev`) with submission review, versioning and one-click install; free and paid themes. Not planned for now (decision 2026-10-27, ADR 0013) |
| FR-THM-12 | V1 | Theme-level hooks: a theme may register storefront-only extension points (`section.register`, `checkout.extra_fields`) that plugins can fill |

### 3.17 Plugin system

Plugins extend the back office, the API and the storefront in the WordPress sense: installable packages developed independently, loaded at runtime, with their own settings pages, data, hooks and UI. Core capabilities (Stripe payments, SMTP email, EU VAT, Xero sync) are themselves plugins, so the plugin API is exercised in production from day one.

| ID | Release | Requirement |
| --- | --- | --- |
| FR-PLG-1 | MVP | Plugin package format: npm package with `openrent.plugin.json` manifest (id, name, version, author, license, `compat` core range, permissions requested, settings schema, locales, admin UI entry, migrations). Signed with the author's key when distributed through the directory |
| FR-PLG-2 | MVP | Install by uploading a ZIP/tarball in Settings → Plugins or by placing in `PLUGINS_DIR`; installing from a public directory is deferred (FR-PLG-10). Enable/disable per tenant; configuration per tenant through the generated settings UI; plugin state visible (loaded, errored, incompatible) |
| FR-PLG-3 | MVP | Server extension points: lifecycle hooks (`before`/`after` on every service method, e.g. `orders.transition`, `pricing.quote`, `documents.render`, `availability.check`), event subscriptions (all webhook events), provider interfaces (`PaymentProvider`, `TaxProvider`, `NotificationChannel`, `StorageProvider`, `SignatureProvider`, `IdentityProvider`, `SearchProvider`), scheduled jobs (cron), custom REST routes under `/api/v1/plugins/{id}/*` with the same auth and OpenAPI generation, custom webhook events |
| FR-PLG-4 | MVP | Data extension: custom fields on core entities; plugin-owned tables (`plg_{id}_*`) via plugin migrations; never altering core tables; plugin data included in tenant export |
| FR-PLG-5 | MVP | Admin UI extension: named slots (`order.sidebar`, `order.actions`, `product.tab`, `customer.tab`, `dashboard.widget`, `settings.page`, `nav.item`, `scan.mode`); plugin UI is a Svelte bundle loaded with dynamic import, rendered inside the shadcn design system with shared tokens and components from `packages/ui` |
| FR-PLG-6 | MVP | Storefront extension: plugins may inject checkout fields and validation, cart/order line metadata, product badges, storefront routes and scripts (consent-aware), all through theme-declared slots so themes stay in control of layout |
| FR-PLG-7 | MVP | Isolation and safety: plugins run in-process but receive a scoped context (tenant-bound db handle, services, logger, secrets store, events); a hook that throws is logged and surfaced; plugins cannot bypass RLS; requested permissions are shown at install; a plugin can be disabled from the CLI if it breaks the admin |
| FR-PLG-8 | MVP | Versioning: plugin API semver'd; core refuses to load incompatible plugins; deprecations announced one minor release ahead with runtime warnings |
| FR-PLG-9 | MVP | Plugin developer kit: `create-openrent-plugin` scaffold (TypeScript), typed `@openrent/plugin-sdk`, local dev server with hot reload, test harness with an in-memory tenant, `openrent plugin check` and `openrent plugin pack` |
| FR-PLG-10 | Deferred | Public plugin directory with review, signing, versioning and one-click install; usage telemetry opt-in for authors. Not planned for now (decision 2026-10-27, ADR 0013) |
| FR-PLG-11 | Deferred | Marketplace billing for paid plugins and themes (optional, via the hosted service). Not planned for now (decision 2026-10-27, ADR 0013) |

### 3.18 Internationalisation (i18n)

| ID | Release | Requirement |
| --- | --- | --- |
| FR-I18N-1 | MVP | All UI strings in admin, storefront, widget, emails and documents are externalised as typed `paraglide-js` messages with ICU plural/select; no hard-coded user-facing text passes lint |
| FR-I18N-2 | MVP | Admin language per user (profile setting, defaults to browser language); storefront languages per tenant with a default, language switcher, `hreflang` and locale-prefixed URLs (`/en/`, `/et/`); emails sent in the recipient's language |
| FR-I18N-3 | MVP | Launch locales: en, nl, de, fr, es, et; community locales via Weblate or Crowdin synced to the repo; pseudo-locale build in CI catches concatenation and overflow |
| FR-I18N-4 | MVP | Tenant-translatable content: product names/descriptions, categories, custom field labels, document and notification templates, theme strings and policies, stored as `translations JSONB` keyed by locale with fallback chain (requested → tenant default → en) |
| FR-I18N-5 | MVP | Locale-aware formatting of dates, times, numbers, currency and units via `Intl`; first day of week and 12/24 h from locale; RTL layouts supported by logical CSS |
| FR-I18N-6 | MVP | Themes and plugins ship `locales/*.json` in the same message format; translations editor in admin shows core, theme and plugin strings together with override per tenant |
| FR-I18N-7 | V1 | Multi-currency display on storefront (base currency charged) and per-locale tax display rules |

## 4. UI principles

Two surfaces share one design system (`packages/ui`, Svelte + Tailwind): the **back office** for staff and the **storefront/widget** for customers. Both consume only the public API.

### 4.1 Shared design system

- **Tokens first, shadcn conventions.** The back office follows the shadcn/ui standard: semantic CSS variables (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`) in HSL, mapped into the Tailwind theme, with light and dark modes (`prefers-color-scheme` + manual toggle). The default primary is **cyan** (Tailwind `cyan-600` light / `cyan-400` dark); primary hue, radius, font and density are configurable in Settings → Appearance and in `apps/admin/theme.config.ts`, and a single `tokens.json` generates both the shadcn variables and the storefront token set.
- **Components.** Built with `shadcn-svelte` (bits-ui primitives, Tailwind, `tailwind-variants`): components are copied into `packages/ui` so the team owns and can adapt every one, following shadcn naming, anatomy, variant and accessibility conventions. Set: Button, Input, Select, Combobox, Command (palette), DatePicker, DateRangePicker, TimePicker, DataTable (sortable, virtualised, column picker), Sheet/Drawer, Dialog, Sonner toast, Tabs, Badge, StatusPill, EmptyState, Skeleton, Money, Duration, Barcode. Every component has a Storybook story and an axe test.
- **Typography.** System font stack by default (`Inter` optional); 14 px base in back office, 16 px in storefront; 1.5 line height.
- **Density.** Back office uses compact density (32 px rows, 8 px grid). Storefront uses comfortable density with 44 px touch targets.
- **Status colours carry meaning and are never the only signal:** every status has an icon or label. Palette: neutral (draft), blue (quote/reserved), violet (prepared), green (out/paid), amber (partial/overdue soon), red (overdue/damaged/failed), grey (closed/cancelled).
- **Money and time.** Amounts always formatted with `Intl.NumberFormat` in tenant currency; times shown in the location's timezone with the zone abbreviation when it differs from the viewer's; relative times ("in 2 h") only alongside the absolute value.
- **Accessibility.** WCAG 2.2 AA: 4.5:1 contrast, visible focus rings, full keyboard operation, ARIA live regions for scan feedback and toasts, reduced-motion respected, no information by colour alone. Automated axe checks in CI; manual screen-reader pass per release.
- **Internationalisation (i18n).** Admin and storefront are fully multi-language: `paraglide-js` (compile-time, typed messages) for UI strings; ICU plural/select; RTL-ready layout via logical CSS properties; dates and numbers via `Intl`. Each user picks an admin language; each tenant defines storefront languages with a default; themes and plugins ship their own message catalogs in the same format. Details in 3.18.

### 4.2 Back office (admin) principles

1. **Counter-speed.** The three most frequent tasks — find an order, check out, check in — are reachable in two interactions from anywhere: global search (`/` or `Ctrl+K`) accepts order number, customer name, barcode or phone; a scan anywhere opens the matching entity.
2. **Scan-first.** Any screen listens for HID scanner input (prefix/suffix detection, 50 ms inter-key threshold). Camera scanning is one tap away on mobile. Feedback is immediate: green flash + tone on success, red + distinct tone on error, with the reason in words.
3. **Keyboard-first.** Every list has `j/k` navigation, `Enter` to open, `e` to edit; forms submit with `Ctrl+Enter`; a `?` overlay lists shortcuts. No action is mouse-only.
4. **Layout.** Persistent left navigation (Dashboard, Orders, Calendar, Products, Inventory, Customers, Documents, Payments, Maintenance, Reports, Settings); content area with page header (title, primary action, secondary actions in a menu); right-hand drawer for quick edits so context is not lost; full page only for creation flows.
5. **Order page is the hub.** One page shows lines with unit assignments, timeline, customer, payments and deposit, documents, notes and activity. Status transitions are a single primary button whose label is the next action ("Mark picked up"), with other transitions in a menu. Blocked transitions explain why ("2 units not yet assigned").
6. **Calendar/planner.** Day/week/month views by location; timeline (Gantt) per unit with drag to move or reassign; shortage and buffer periods visually distinct; filters by category and status; create order by dragging a range.
7. **Progressive disclosure.** Defaults cover 80% of shops; advanced settings sit behind "Advanced" sections. Single-location tenants never see location pickers; bulk-only tenants never see serial fields.
8. **Inline validation and optimistic UI.** Validate on blur with specific messages; save optimistically with rollback on error; show server-side conflict (`409`) as a reload prompt with the diff.
9. **Bulk actions.** Multi-select in every table with contextual actions (print labels, change status, export, tag).
10. **Mobile back office.** A responsive PWA, installable, with a bottom tab bar (Today, Scan, Orders, Search) for warehouse and counter staff; works offline for scanning (queued).
11. **Empty states teach.** Each empty list explains what belongs there and offers the first action and a link to docs.
12. **Undo over confirm.** Reversible actions execute immediately with an undo toast (8 s); irreversible ones (issue invoice, capture deposit, delete) require confirmation stating the consequence.

### 4.3 Storefront and widget principles

1. **Dates before browsing.** A sticky date/location bar lets customers set rental dates first so the catalogue shows only what is available, with live prices for the selected period. Dates persist across pages and in the cart.
2. **Price transparency.** Product page shows price for the chosen period, the pricing rule in plain words ("€25/day, 3rd day onwards €15"), deposit amount and any fees before the customer adds to cart. Checkout shows the same breakdown as the `price-quote` endpoint returns.
3. **Availability clarity.** Calendar shows unavailable dates disabled with a reason tooltip (closed, fully booked, minimum notice); quantity selector caps at available units.
4. **Mobile-first, fast.** First contentful paint < 1.5 s on 4G; hosted storefront built as SvelteKit with SSR; widget hydrates lazily; images via responsive `srcset` and WebP/AVIF.
5. **Checkout in one page** with sections (contact, pickup/return details, extras, terms, payment); guest by default; errors inline; payment via provider-hosted fields (PCI SAQ-A); confirmation with order summary, QR code, calendar links and documents.
6. **Merchant branding wins.** The active theme (default theme or an uploaded theme ZIP) controls storefront layout, templates and styling, as on Shopify; tenants customise its settings, tokens, logo, fonts and custom CSS without code; OpenRent branding is a small optional footer line.
7. **Embeddable widget contract.** `<openrent-product product="slug" tenant="key">`, `<openrent-catalog category="bikes">`, `<openrent-book-button>`; Shadow DOM isolation; CSS custom properties exposed for theming; events (`openrent:add-to-cart`, `openrent:checkout-complete`) for the host page.
8. **Accessibility and i18n** as in 4.1; language switch and currency display follow tenant settings; all legal texts (terms, privacy, cancellation policy) linked at checkout.

## 5. API design

The API is the product. The OpenAPI 3.1 document is the source of truth, lives in `packages/api-spec`, and is reviewed in every PR; server handlers, the TypeScript SDK and the docs site are generated from it. Any feature without an endpoint in the spec is incomplete.

### 5.1 Principles

1. **Resource-oriented REST over HTTPS**, JSON bodies (`application/json`), UTF-8, `snake_case` fields, ISO 8601 timestamps with offset (`2026-10-24T13:19:00+03:00`), money as integer minor units plus currency code (`{"amount": 2500, "currency": "EUR"}`), durations in minutes, IDs as prefixed ULIDs (`ord_01J...`, `prod_01J...`) that are opaque to clients.
2. **Actions as sub-resources, not verbs on PATCH.** State transitions are `POST /orders/{id}/actions/{action}` (e.g. `reserve`, `prepare`, `check_out`, `check_in`, `cancel`). This keeps the state machine explicit and auditable.
3. **Versioning in the path** (`/api/v1`). Backwards-compatible additions (new fields, new endpoints, new enum values clients must tolerate) do not bump the version. Breaking changes ship as `/api/v2` with a 12-month overlap and `Sunset` + `Deprecation` headers on v1.
4. **Idempotency.** Every `POST` accepts an `Idempotency-Key` header (UUID). The server stores the key, request hash and response for 24 h per tenant; a replay returns the stored response; a key reuse with a different body returns `422 idempotency_key_reused`.
5. **Optimistic concurrency.** Mutable resources return an `ETag`; `PATCH`/`PUT`/action calls may send `If-Match`; a mismatch returns `412 precondition_failed` with the current resource.
6. **Expansion, not nesting by default.** Responses are flat; `?expand=customer,lines.variant` embeds related objects one level deep (max 3 expands). Lists support `?fields=` sparse fieldsets.
7. **Cursor pagination** on all lists: `?limit=` (default 50, max 200), `?cursor=`; response `{"data": [...], "next_cursor": "...", "has_more": true}`. Sorting via `?sort=-created_at,number`.
8. **Filtering** with a small, documented grammar: `?filter[status]=reserved,out`, `?filter[starts_at][gte]=2026-11-01`, `?filter[customer_id]=cus_...`, `?q=` for full-text. Unknown filters return `400`.
9. **Errors** follow RFC 9457 Problem Details: `{"type": "https://openrent.dev/errors/invalid_transition", "title": "Invalid transition", "status": 409, "code": "invalid_transition", "detail": "Order must be prepared before check-out", "errors": [{"field": "lines[0].quantity", "code": "exceeds_availability", "message": "Only 2 available"}], "request_id": "req_..."}`. Every error has a stable `code`. Validation errors list each field.
10. **Rate limits** per API key: default 600 requests/min, 60/min for `price-quote` from publishable keys; headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; `429` with `Retry-After`.
11. **Consistency.** Reads after a successful write are strongly consistent (single Postgres primary). Webhooks (Section 6) are eventually consistent.
12. **Dry-run.** Mutating endpoints that compute (price-quote, availability check, import) accept `?dry_run=true` and return the result without persisting.
13. **Request IDs and tracing.** Every response carries `X-Request-Id`; `traceparent` is propagated.
14. **Time zones.** Clients send offsets; the server stores UTC plus the location's IANA zone on the order; calendars return both.
15. **Bulk endpoints** exist where UIs need them (`POST /stock-items/batch`, `POST /availability/batch`, `POST /labels/batch`), limited to 100 items per call, with per-item results.

### 5.2 Authentication and authorisation

| Credential | Audience | How | Scope |
| --- | --- | --- | --- |
| Session cookie | Back office SPA | `POST /auth/login` (email + password or magic link), optional TOTP step; HttpOnly, SameSite=Lax, CSRF token on state-changing requests | User's role permissions |
| Secret API key | Server-to-server integrations | `Authorization: Bearer sk_live_...`; created in Settings with named scopes (`orders:read`, `orders:write`, `payments:write`, `webhooks:manage`, `*`); shown once; rotatable; last-used tracking | Explicit scopes |
| Publishable key | Storefront and widget in browsers | `Authorization: Bearer pk_live_...`; may only call the `/storefront/*` namespace (catalogue, availability, price-quote, checkout sessions, order lookup by token) | Read catalogue, create checkout |
| Customer token | Customer portal | Signed link or OTP login → short-lived JWT; may read own orders and documents and pay | Own data |
| OAuth 2.1 (V1) | Third-party apps | Authorization code + PKCE; scopes as API keys; refresh tokens | Granted scopes |

Permissions are evaluated per endpoint and per tenant; a user with multiple tenants switches with `X-Tenant-Id`. Every request runs under a Postgres role with RLS set to the tenant.

### 5.3 Namespaces

| Prefix | Audience | Notes |
| --- | --- | --- |
| `/api/v1/*` | Back office, integrations | Full CRUD and actions; requires session or secret key |
| `/api/v1/storefront/*` | Public storefront/widget | Publishable key; read-only catalogue + checkout; aggressive caching (`Cache-Control`, `ETag`) |
| `/api/v1/portal/*` | Customers | Customer token |
| `/api/v1/system/*` | Operators | Health, metrics, migrations status; protected by operator key |

### 5.4 Endpoint catalog (v1)

All list endpoints support pagination, filtering, sorting and `expand`. `{id}` accepts the ULID or, where noted, a human number (`#1042`).

| Resource | Endpoints | Actions |
| --- | --- | --- |
| Tenants | `GET/PATCH /tenant`, `GET/PATCH /tenant/settings`, `GET /tenant/export` | `POST /tenant/export` (async job) |
| Locations | `GET/POST /locations`, `GET/PATCH/DELETE /locations/{id}` | `POST /locations/{id}/blackouts` |
| Users & roles | `GET/POST /users`, `GET/PATCH/DELETE /users/{id}`, `GET/POST /roles`, `GET/PATCH/DELETE /roles/{id}` | `POST /users/{id}/actions/invite`, `/reset_password`, `/disable` |
| Auth | `POST /auth/login`, `/auth/logout`, `/auth/magic_link`, `/auth/totp/enroll`, `/auth/totp/verify`, `GET /auth/me` |  |
| API keys | `GET/POST /api_keys`, `DELETE /api_keys/{id}` | `POST /api_keys/{id}/actions/rotate` |
| Products | `GET/POST /products`, `GET/PATCH/DELETE /products/{id}`, `GET/POST /products/{id}/variants`, `GET/PATCH/DELETE /variants/{id}`, `GET/POST /categories`, `GET/POST /products/{id}/images` | `POST /products/{id}/actions/archive`, `/duplicate` |
| Bundles | `GET/POST /bundles`, `GET/PATCH/DELETE /bundles/{id}`, `GET/PUT /bundles/{id}/components` |  |
| Stock items | `GET/POST /stock_items`, `GET/PATCH/DELETE /stock_items/{id}`, `POST /stock_items/batch`, `GET /stock_items/by_barcode/{code}` | `POST /stock_items/{id}/actions/set_status`, `/transfer`, `/retire`, `/add_meter_reading` |
| Stock levels (bulk) | `GET /stock_levels`, `PUT /stock_levels/{variant_id}/{location_id}` | `POST /stock_levels/{variant_id}/{location_id}/actions/adjust` (delta + reason) |
| Availability | `GET /availability?variant_id&location_id&from&to`, `POST /availability/batch`, `GET /availability/calendar?variant_id&month`, `GET/POST /downtimes`, `DELETE /downtimes/{id}` |  |
| Pricing | `GET/POST /price_structures`, `GET/PATCH/DELETE /price_structures/{id}`, `GET/POST /price_rules`, `GET/POST /coupons`, `GET/PATCH/DELETE /coupons/{id}`, `GET/POST /tax_profiles`, `POST /price_quote` | `POST /coupons/{id}/actions/disable` |
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/{id}`, `GET /customers/{id}/orders`, `GET /customers/{id}/export` | `POST /customers/{id}/actions/merge`, `/block`, `/unblock`, `/anonymize`, `/send_portal_link` |
| Orders | `GET/POST /orders`, `GET/PATCH /orders/{id}`, `GET/POST /orders/{id}/lines`, `PATCH/DELETE /orders/{id}/lines/{line_id}`, `GET /orders/{id}/timeline`, `GET /orders/{id}/pick_list` | `POST /orders/{id}/actions/`: `send_quote`, `reserve`, `prepare`, `assign_units` (body: line\_id, stock\_item\_ids), `unassign_units`, `check_out` (scanned ids/qty, signature), `check_in` (per-unit outcomes), `inspect`, `extend`, `return_early`, `swap_unit`, `cancel`, `close`, `reopen`, `duplicate` |
| Documents | `GET /documents`, `GET /documents/{id}`, `GET /documents/{id}/pdf`, `GET/POST /document_templates`, `GET/PATCH /document_templates/{id}`, `POST /document_templates/{id}/preview` | `POST /orders/{id}/documents` (type: quote/contract/invoice/credit\_note/receipt), `POST /documents/{id}/actions/send`, `/void` (credit note), `/request_signature`, `GET /documents/{id}/signatures` |
| Payments | `GET /payments`, `GET /payments/{id}`, `POST /orders/{id}/payments` (manual), `POST /orders/{id}/payment_intents`, `POST /orders/{id}/payment_links`, `GET /payment_providers`, `PATCH /payment_providers/{id}` | `POST /payments/{id}/actions/refund`, `/void`; `POST /webhooks/payments/{provider}` (inbound) |
| Deposits | `GET /deposits`, `GET /deposits/{id}`, `POST /orders/{id}/deposits` | `POST /deposits/{id}/actions/authorize`, `/capture` (amount, reason, damage\_charge\_ids), `/release`, `/reauthorize` |
| Damage | `GET/POST /orders/{id}/damage_charges`, `PATCH/DELETE /damage_charges/{id}` | `POST /damage_charges/{id}/actions/waive`, `/invoice` |
| Maintenance | `GET/POST /maintenance_tickets`, `GET/PATCH /maintenance_tickets/{id}`, `GET/POST /inspection_templates`, `POST /stock_items/{id}/inspections` | `POST /maintenance_tickets/{id}/actions/start`, `/resolve`, `/cancel` |
| Deliveries | `GET/POST /deliveries`, `GET/PATCH /deliveries/{id}`, `GET /deliveries/route?date&location_id` | `POST /deliveries/{id}/actions/dispatch`, `/complete` (photo, signature) |
| Labels & scanning | `POST /labels/batch` (ids, format → PDF/ZPL), `POST /scans` (code, mode, context) → resolved entity + suggested action |  |
| Notifications | `GET /notifications`, `GET/PATCH /notification_templates/{id}`, `POST /notification_templates/{id}/test` | `POST /orders/{id}/actions/send_notification` (template\_id) |
| Reports | `GET /reports/{name}?from&to&group_by&location_id` (revenue, utilization, availability\_forecast, fulfilment, overdue, deposits\_held, tax\_summary, coupon\_usage), `POST /reports/{name}/export` (async → file) |  |
| Webhooks | `GET/POST /webhook_endpoints`, `GET/PATCH/DELETE /webhook_endpoints/{id}`, `GET /webhook_endpoints/{id}/deliveries`, `GET /webhook_events` | `POST /webhook_endpoints/{id}/actions/rotate_secret`, `/test`; `POST /webhook_deliveries/{id}/actions/redeliver` |
| Custom fields | `GET/POST /custom_field_definitions`, `PATCH/DELETE /custom_field_definitions/{id}` |  |
| Files | `POST /files` (multipart or presigned URL request), `GET /files/{id}`, `DELETE /files/{id}` |  |
| Jobs | `GET /jobs/{id}` (status of async exports, imports, bulk ops) | `POST /imports` (type, file\_id, mapping, dry\_run) |
| Plugins | `GET /plugins`, `PATCH /plugins/{id}` (enable, config) |  |
| Audit | `GET /audit_log?entity_type&entity_id&actor_id&from&to` |  |
| Storefront (`/storefront`) | `GET /catalog/products`, `GET /catalog/products/{slug}`, `GET /catalog/categories`, `GET /availability`, `POST /price_quote`, `POST /checkout_sessions`, `GET/PATCH /checkout_sessions/{id}`, `POST /checkout_sessions/{id}/actions/complete`, `GET /orders/{id}?token=`, `GET /settings` (theme, locales, policies) |  |
| Portal (`/portal`) | `POST /auth/request_link`, `GET /me`, `GET /orders`, `GET /orders/{id}`, `GET /documents/{id}/pdf`, `POST /orders/{id}/actions/request_extension`, `POST /orders/{id}/payment_intents` |  |
| System (`/system`) | `GET /health` (liveness), `GET /ready` (DB, storage, queue), `GET /metrics` (Prometheus), `GET /version` |  |

### 5.5 Representative payloads

`POST /api/v1/orders`

```json
{
  "customer_id": "cus_01JB...",
  "location_id": "loc_01JB...",
  "starts_at": "2026-11-03T09:00:00+02:00",
  "ends_at": "2026-11-05T18:00:00+02:00",
  "lines": [
    {"type": "rental", "variant_id": "var_01JB...", "quantity": 2},
    {"type": "rental", "variant_id": "var_01JC...", "quantity": 1, "stock_item_ids": ["sti_01JD..."]},
    {"type": "sale", "variant_id": "var_01JE...", "quantity": 3}
  ],
  "coupon_codes": ["AUTUMN10"],
  "deposit": {"mode": "auto"},
  "notes": {"internal": "Regular customer"},
  "custom_fields": {"event_name": "Film shoot"}
}
```

Response `201` returns the order with `status: "draft"`, computed `totals` (`subtotal`, `discount`, `fees`, `tax`, `total`, `deposit`, `paid`, `balance`), `lines[].price_snapshot` and `availability_check` per line. `POST /orders/{id}/actions/reserve` then holds stock or returns `409 exceeds_availability` with the available quantity per line.

`POST /api/v1/price_quote` accepts the same shape without `customer_id` required and returns the breakdown only; the storefront calls `/storefront/price_quote` with a publishable key.

### 5.6 SDKs and tooling

- `@openrent/sdk` (TypeScript, generated with `openapi-typescript` + a thin fetch client with retries and idempotency); Python and PHP generated clients in V1.
- Interactive docs (Scalar) at `/docs`; Postman/Bruno collection exported from the spec.
- Contract tests: every endpoint has a spec-driven test (request/response validated against the OpenAPI schema) and a changelog entry generated from spec diffs.

## 6. Webhooks

Webhooks notify external systems of every state change with at-least-once delivery, HMAC signing and automatic retries. They are produced from the same transactional outbox that drives internal jobs, so an event is emitted if and only if its transaction committed.

### 6.1 Event catalog

Event names are `resource.event`, past tense. Every mutation that changes a resource's persisted state emits an event; the list below is the v1 minimum and the spec enumerates all of them.

| Resource | Events |
| --- | --- |
| order | `order.created`, `order.updated`, `order.status_changed` (with `from`, `to`), `order.quote_sent`, `order.reserved`, `order.prepared`, `order.checked_out`, `order.checked_in` (partial flag), `order.inspected`, `order.closed`, `order.cancelled`, `order.expired`, `order.overdue`, `order.extended`, `order.units_assigned` |
| customer | `customer.created`, `customer.updated`, `customer.merged`, `customer.anonymized`, `customer.blocked` |
| product / inventory | `product.created`, `product.updated`, `product.archived`, `variant.created`, `variant.updated`, `stock_item.created`, `stock_item.status_changed`, `stock_item.transferred`, `stock_level.adjusted`, `downtime.created`, `downtime.deleted` |
| pricing | `coupon.created`, `coupon.redeemed`, `price_structure.updated`, `price_rule.updated` |
| document | `document.issued`, `document.sent`, `document.viewed`, `document.signed`, `document.voided` |
| payment | `payment.succeeded`, `payment.failed`, `payment.refunded`, `payment_intent.created`, `payment_link.paid` |
| deposit | `deposit.authorized`, `deposit.captured`, `deposit.released`, `deposit.expiring` (N days before), `deposit.expired`, `deposit.failed` |
| damage | `damage_charge.created`, `damage_charge.waived`, `damage_charge.invoiced` |
| maintenance | `maintenance_ticket.created`, `maintenance_ticket.resolved`, `inspection.completed` |
| delivery | `delivery.scheduled`, `delivery.dispatched`, `delivery.completed` |
| notification | `notification.sent`, `notification.bounced` |
| system | `export.completed`, `import.completed`, `webhook_endpoint.disabled` |

### 6.2 Endpoint configuration

- Created via `POST /webhook_endpoints` with `url` (HTTPS only, no private IP ranges unless `allow_private_network` is enabled by the operator), `events` (list or `*`), `description`, optional `api_version`.
- Secret (`whsec_...`, 32 random bytes, base64) is returned once on creation and on `rotate_secret`; during rotation both old and new secrets sign deliveries for 24 h.
- Each endpoint has `status`: `enabled`, `disabled_by_user`, `disabled_failures` (auto-disabled after 3 days of continuous failure; `webhook_endpoint.disabled` is emitted and the owner emailed).
- Test delivery: `POST /webhook_endpoints/{id}/actions/test` sends a `ping` event.

### 6.3 Delivery payload

```json
{
  "id": "evt_01JB7X...",
  "type": "order.status_changed",
  "api_version": "2026-10-01",
  "created_at": "2026-10-24T13:19:02.418Z",
  "tenant_id": "ten_01J...",
  "livemode": true,
  "data": {
    "object": { "id": "ord_01JB...", "status": "out", "...": "full order resource" },
    "previous_attributes": { "status": "prepared" }
  },
  "request": { "id": "req_...", "idempotency_key": "..." },
  "actor": { "type": "user", "id": "usr_01J..." }
}
```

Headers: `Content-Type: application/json`, `User-Agent: OpenRent-Webhooks/1.0`, `OpenRent-Event-Id`, `OpenRent-Event-Type`, `OpenRent-Delivery-Id`, `OpenRent-Delivery-Attempt`, `OpenRent-Signature`.

### 6.4 Signing and verification

- `OpenRent-Signature: t=1761311942,v1=<hex HMAC-SHA256>` where the signed string is `${t}.${raw_body}`. Multiple `v1=` values appear during secret rotation.
- Receivers must verify with the raw body (not re-serialised JSON), compare with constant-time equality and reject timestamps older than 5 minutes.
- Reference verifiers are provided in the SDKs (`verifyWebhook(rawBody, header, secret)`), with code samples for Node, Python, PHP and Go in the docs.

### 6.5 Delivery semantics

| Property | Behaviour |
| --- | --- |
| Guarantee | At-least-once. Receivers must deduplicate on `id` |
| Ordering | Not guaranteed across events; each payload carries the full current object so the latest delivery is authoritative |
| Timeout | 10 s to respond; any `2xx` is success |
| Retries | Exponential backoff with jitter: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, 24 h (8 attempts over \~3 days) |
| Failure handling | After the schedule is exhausted the delivery is marked `failed`; the endpoint is auto-disabled after 3 days of 100% failure |
| Replay | `POST /webhook_deliveries/{id}/actions/redeliver`; the UI lists deliveries with request/response bodies and lets staff resend or filter by event |
| Fan-out | Each endpoint receives its own delivery; failures on one endpoint never affect others |
| Throughput | Deliveries run from the job queue with per-endpoint concurrency 4 and global concurrency configurable |
| Payload size | Full object up to 256 KB; larger objects (e.g. orders with 500 lines) are sent as a thin payload with `data.object = {id, url}` and `truncated: true` |

### 6.6 Inbound webhooks

Payment and e-sign providers post to `POST /webhooks/{provider}` on a tenant-scoped URL (`/webhooks/stripe/{tenant_id}`). Each provider plugin verifies its own signature, maps the event to a provider-independent internal event and records the provider event ID for idempotency. Unknown or replayed events return `200` and are logged.

### 6.7 Internal event bus

The same outbox feeds in-process subscribers (notifications, reports materialisation, plugins). Plugins subscribe with `on('order.checked_out', handler)`; a plugin handler failing is logged and surfaced in Settings → Plugins but never fails the originating request.

## 7. Tech stack and architecture

OpenRent is a TypeScript modular monolith: one Node API service, one worker process, a SvelteKit back office, a SvelteKit storefront, and a Web Components widget, all on PostgreSQL. This keeps the default install to three containers while allowing the API and worker to scale independently.

### 7.1 Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Runtime | Node.js 22 LTS, TypeScript 5 (strict), ESM | Largest contributor pool; one language across API, UI, widget and SDK |
| Monorepo | pnpm workspaces + Turborepo; Changesets for versioning | Shared packages, cached builds, independent publishing of SDK and widget |
| API framework | Fastify 5 with `@fastify/type-provider-typebox`; OpenAPI generated from TypeBox schemas | Fast, schema-first, mature plugin model; schemas serve as validation, types and docs |
| Database | PostgreSQL 16 (`btree_gist`, `pgcrypto`, `pg_trgm`, `unaccent`) | Range types + exclusion constraints give DB-level double-booking prevention; RLS for tenancy; full-text search |
| ORM / migrations | Drizzle ORM + drizzle-kit SQL migrations; raw SQL allowed for constraints and reports | Type-safe queries without hiding SQL; migrations are plain SQL files reviewed in PRs |
| Jobs and scheduling | pg-boss (Postgres-backed queue) | No extra broker; transactional enqueue; cron for reminders and reconciliation. Redis is an optional accelerator for cache/rate limits at scale |
| Back office | SvelteKit 2 (Svelte 5 runes), adapter-node, SPA-mode routes behind auth; Tailwind CSS 4; `bits-ui` shadcn-svelte components (cyan default primary, configurable tokens); TanStack Query (svelte) for API state; `superforms` + TypeBox for forms | Compiled, small bundles; excellent form and reactivity ergonomics |
| Storefront | SvelteKit 2 with SSR (adapter-node), Tailwind; rendered through the theme runtime (installable Shopify-style themes); separate deployable | SEO and speed for merchant shops |
| Widget | Svelte compiled to custom elements (`customElement: true`), Shadow DOM, single IIFE bundle via Vite | Drops into any site; isolated styles |
| Auth | Lucia-style session management in Postgres; Argon2id (`@node-rs/argon2`); TOTP (`otpauth`); OIDC via `openid-client`; CSRF double-submit | No vendor lock-in; proven primitives |
| Payments | Stripe SDK as reference `PaymentProvider`; provider interface in `packages/core` | Pre-auth/capture/refund semantics map cleanly to deposits |
| PDF | Playwright (Chromium) rendering HTML templates in the worker; templates in Handlebars with helpers for money/date | Pixel-accurate documents, same templates preview in browser |
| Email | Nodemailer (SMTP) + provider adapters; MJML-free HTML templates with inline CSS; `mailpit` in dev | Works anywhere SMTP works |
| Files | S3-compatible storage (MinIO in Compose) via AWS SDK v3; presigned uploads; `sharp` for image variants | Standard, swappable |
| Barcodes | `bwip-js` for Code128/QR generation; `BarcodeDetector` + `@zxing/browser` fallback for camera scanning | Server labels and client scanning without native code |
| i18n | `paraglide-js` (inlang) for UI; ICU messages; per-tenant translations stored in DB for product content and templates | Compile-time typed messages; tenant content stays data |
| Search | Postgres full-text (`tsvector`, `pg_trgm`) with optional Meilisearch plugin | Good enough for ≤ 100k products without another service |
| Observability | OpenTelemetry SDK (traces, metrics) → OTLP; pino structured logs; `/system/metrics` Prometheus | Standard, vendor-neutral |
| Testing | Vitest (unit), Testcontainers-Postgres (integration), Playwright (e2e), Schemathesis-style OpenAPI fuzzing, fast-check property tests for availability and pricing | Confidence on the invariants that matter |
| Quality | ESLint (typescript-eslint, svelte), Prettier, Biome optional; Husky + lint-staged; GitHub Actions matrix (Node 22, PG 16) |  |
| Containers | Distroless Node images; multi-arch (amd64, arm64); Docker Compose for default install; Helm chart in V1 | Self-hosting is first class |

### 7.2 Repository layout

```text
openrent/
  apps/
    api/            Fastify service: routes, auth, RLS, OpenAPI, outbox publisher
    worker/         pg-boss consumers: emails, PDFs, webhooks, reminders, reconciliation, exports
    admin/          SvelteKit back office (SPA routes, Tailwind, bits-ui)
    storefront/     SvelteKit SSR storefront (multi-tenant by host)
    widget/         Svelte custom elements bundle (<openrent-product> etc.)
    docs/           Docs site (Astro Starlight) incl. generated API reference
  packages/
    core/           Domain modules: catalog, inventory, availability, pricing, orders, payments,
                    documents, customers, notifications, reporting (pure TS, no HTTP)
    db/             Drizzle schema, SQL migrations, seed, RLS policies
    api-spec/       OpenAPI 3.1 document (generated + hand-written descriptions), lint rules (Spectral)
    sdk/            @openrent/sdk generated TypeScript client + webhook verifier
    ui/             Shared Svelte components, tokens, Tailwind preset, Storybook
    plugin-sdk/     Plugin types, hook registry, provider interfaces
    plugins/        First-party plugins: payment-stripe, payment-mollie, tax-eu-vat,
                    notify-smtp, notify-twilio, accounting-xero, storage-s3
    config/         Shared tsconfig, eslint, prettier
  deploy/
    compose/        docker-compose.yml (+ .prod, .dev), Caddy config, env templates
    helm/           Chart (V1)
  scripts/          dev bootstrap, db reset, openapi generate, release
```

### 7.3 Runtime architecture

&#91;embedded content: runtime architecture · 5 containers plus external providers\]

All three clients reach the same API through Caddy; the API writes domain rows and outbox rows in one transaction, and the worker drains the outbox into emails, PDFs and signed webhooks.

**Request path.** Caddy (TLS, routing by host/path) → `api` (Fastify). Each request authenticates, resolves the tenant, opens a Postgres transaction with `SET LOCAL app.tenant_id`, and calls a `packages/core` service. Services write domain rows and outbox rows in the same transaction. A `LISTEN/NOTIFY` wake-up plus a 1 s poll moves outbox rows into pg-boss jobs; the `worker` runs them (email, PDF, webhook delivery, reminders) with retries and dead-lettering.

**Domain module rules (`packages/core`).** Each module exposes a service interface and owns its tables; cross-module access goes through services, never through another module's tables. Modules: `catalog`, `inventory`, `availability`, `pricing`, `orders`, `payments`, `documents`, `customers`, `notifications`, `reporting`, `tenancy`, `audit`. A dependency-cruiser rule enforces the allowed graph (e.g. `orders → availability, pricing, inventory`; nothing depends on `orders` except `payments`, `documents`, `reporting`).

**Multi-tenancy.** Every table has `tenant_id`; RLS policies compare it with `current_setting('app.tenant_id')`. The API connects with a non-superuser role that cannot bypass RLS. Single-tenant installs still run RLS (one tenant). Hosted mode adds tenant signup, custom-domain routing and per-tenant storage prefixes; no code paths differ.

### 7.4 Availability engine

The engine is the core technical differentiator and lives in `packages/core/availability` with its constraints in `packages/db`.

- **Allocation rows.** `allocations(id, tenant_id, variant_id, location_id, stock_item_id NULL, quantity, period tstzrange, kind ENUM(reservation, downtime, buffer, transfer), order_line_id NULL, downtime_id NULL)`. `period` already includes buffers (`[starts_at − buffer_before, ends_at + buffer_after)`), so overlap maths is uniform.
- **Serialised invariant.** `EXCLUDE USING gist (stock_item_id WITH =, period WITH &&) WHERE (stock_item_id IS NOT NULL)` on `allocations`. A conflicting insert fails with SQLSTATE `23P01`, mapped to `409 exceeds_availability`.
- **Bulk invariant.** For `stock_item_id IS NULL` rows: inside a `SERIALIZABLE` transaction (retry on `40001` up to 3 times) compute `SUM(quantity)` over overlapping allocations for `(variant_id, location_id)`; compare against `stock_levels.quantity` (or count of active stock items for unassigned serialised reservations); insert or reject. A `pg_advisory_xact_lock(hashtext(variant_id||location_id))` serialises hot variants to avoid retry storms.
- **Capacity.** Serialised: `COUNT(stock_items WHERE status NOT IN (retired, lost, hard_down))` plus temporary stock in range. Bulk: `stock_levels.quantity` plus temporary stock.
- **Query.** `available(variant, location, range) = capacity − max over the range of concurrent allocated quantity`. Implemented with a sweep over allocation boundaries in SQL (`generate_series` is avoided; boundaries are the `lower()`/`upper()` of overlapping periods). Calendar month queries return per-day minimum availability.
- **Bundles.** Expand to component allocations within the same transaction; the bundle line stores component allocation IDs; availability of the bundle is computed from components.
- **Late binding.** Reservations insert quantity rows with `stock_item_id NULL`; `assign_units` converts them into per-unit rows atomically (delete quantity row, insert N unit rows) so the exclusion constraint takes over.
- **Performance.** GiST index on `(tenant_id, variant_id, location_id, period)`; target p95 < 100 ms for 1 variant × 90 days at 10k units per tenant, verified by a benchmark in CI.

### 7.5 Pricing engine

Pure function `quote(input, rules, now) → breakdown` in `packages/core/pricing`, no I/O. Steps: resolve price structure → compute chargeable periods (calendar vs charge days) → apply tiered/table prices → apply price rules in priority order (season, weekday, customer group) → apply coupons (respecting combinability) → add fees (delivery, waiver, late) → compute deposit → compute tax per line → round per tenant rule. Every step appends to an `explanation[]` array returned to the API so UIs can show "why this price". Property tests assert monotonicity (longer rental never cheaper unless a rule says so) and tax totals.

### 7.6 Order state machine

Implemented with a declarative transition table in `packages/core/orders/state.ts`: `{from, to, action, guards[], effects[]}`. Guards check allocation, payment and assignment preconditions; effects release/convert allocations, issue documents, enqueue notifications and emit `order.status_changed`. The table is exported to the OpenAPI spec as documentation and to the admin UI to render available actions.

### 7.7 Plugin system

- A plugin is an npm package exporting `definePlugin({ id, version, compat: ">=1.0 <2", hooks, providers, routes, adminSlots, migrations })`.
- Loaded at boot from `plugins.json`; each receives a scoped `ctx` (db with tenant RLS, services, logger, config, events).
- Providers: `PaymentProvider`, `TaxProvider`, `NotificationChannel`, `StorageProvider`, `SignatureProvider`, `IdentityProvider`.
- Hooks: `before`/`after` on service methods (`orders.transition`, `pricing.quote`, `documents.render`), plus event subscriptions.
- Admin UI slots: plugins ship a Svelte component bundle registered for named slots (`order.sidebar`, `product.tab`, `settings.page`), loaded via dynamic import from `/plugins/{id}/ui.js`.
- Plugins may own tables prefixed `plg_{id}_` via their own migrations; they may add custom fields to core entities but never alter core tables.

### 7.8 Frontend architecture

- `apps/admin`: SvelteKit with `ssr = false` for authenticated routes, server `hooks` for session cookie → API token exchange; data via TanStack Query hitting `/api/v1` through the generated SDK; route groups per domain; global scan listener store; command palette; feature flags from `/tenant/settings`.
- `apps/storefront`: SSR per request keyed by host → tenant; catalogue pages cached with `stale-while-revalidate`; cart in cookie-backed checkout session; theming by injecting tenant CSS variables in `<head>`.
- `apps/widget`: Svelte custom elements; shared components from `packages/ui` compiled in; communicates with host via custom events; checkout rendered inside the shadow root with provider-hosted payment iframe.
- Shared validation: TypeBox schemas from `packages/api-spec` reused in forms so client and server validate identically.

### 7.9 Theme and plugin architecture

Themes and plugins are first-class modules of the runtime, not add-ons: the storefront cannot render without a theme, and core providers are plugins.

- **Theme runtime (`packages/theme-runtime`).** Loads a theme package (from DB-stored ZIP extracted to `THEMES_DIR/{tenant}/{theme}@{version}` or from the filesystem), validates `theme.json` against the theme-API schema, compiles its Svelte templates with the SvelteKit storefront's Vite build in SSR mode (precompiled at install time, cached per version), and renders routes by mapping storefront URLs to templates. Data is fetched by the runtime through the storefront API and passed as typed, read-only objects (`@openrent/theme-sdk` exports the types). Section/block settings come from `settings_data.json` merged with tenant overrides stored in `theme_settings`. Assets are served with content hashes from object storage.
- **Theme isolation.** Server-side templates run in a restricted compile (no `$app/server` imports, no `fetch`, no `fs`); a theme lint step rejects forbidden imports. Browser JS runs under a CSP that allows only the theme bundle and plugin-declared scripts.
- **Plugin host (`packages/plugin-host`).** At boot (and on install without restart, via a supervised reload of the plugin graph) it resolves manifests, checks `compat` ranges, applies plugin migrations in their own schema namespace, registers hooks, providers, routes, jobs and admin slots, and exposes `ctx` (tenant-scoped db, services, events, settings, secrets, logger). Hooks execute in manifest priority order with per-hook timeouts; failures are isolated.
- **Admin slots.** `apps/admin` renders slot outlets; the plugin host serves each enabled plugin's UI bundle at `/plugins/{id}/ui.js`; bundles are built against `packages/ui` externals so they use the host's shadcn components and tokens without duplicating them.
- **Storefront slots.** Themes declare slots in templates (`<Slot name="checkout.extra_fields" />`); the runtime fills them with plugin-registered storefront components, so plugins extend any theme and themes keep layout control.
- **Design tokens pipeline.** `packages/tokens` holds `tokens.json`; a build step emits shadcn CSS variables for admin (default primary cyan), the Tailwind preset, and the storefront token CSS consumed by themes. Admin appearance settings (primary hue, radius, font, density) write a tenant-level override that is injected as CSS variables at runtime, so changing the brand colour needs no rebuild.
- **Directories (deferred, ADR 0013).** `themes.openrent.dev` and `plugins.openrent.dev` would be static indexes (JSON) of reviewed packages with signatures; the admin would install by fetching the package URL and verifying the signature, and self-hosters could point to a private directory. Not planned for now; plugins and themes are shared as npm packages and ZIPs.
- **Testing.** The default theme and first-party plugins are the compatibility suite: every theme-API or plugin-API change must keep them green, and a contract test asserts the public API surface of `@openrent/theme-sdk` and `@openrent/plugin-sdk` against a snapshot.

## 8. Data model

All tables carry `id` (ULID, prefixed in the API), `tenant_id`, `created_at`, `updated_at`, `created_by`, `updated_by`; soft delete (`deleted_at`) only on catalogue and customer tables. Money columns are `BIGINT` minor units with a `currency CHAR(3)`. Times are `TIMESTAMPTZ`. Custom field values live in a `custom_fields JSONB` column validated against `custom_field_definitions`.

### 8.1 Core entities

| Table | Key fields | Constraints and notes |
| --- | --- | --- |
| `tenants` | `slug`, `name`, `legal_name`, `address JSONB`, `tax_ids JSONB`, `currency`, `timezone`, `locale`, `settings JSONB`, `branding JSONB`, `invoice_numbering JSONB` | `slug` unique |
| `locations` | `name`, `address JSONB`, `timezone`, `opening_hours JSONB`, `is_default` | One default per tenant (partial unique index) |
| `location_blackouts` | `location_id`, `period tstzrange`, `reason` | GiST index |
| `users` | `email`, `password_hash`, `name`, `locale`, `totp_secret`, `status` | `email` unique per installation |
| `memberships` | `user_id`, `tenant_id`, `role_id` | Unique `(user_id, tenant_id)` |
| `roles` | `name`, `permissions TEXT[]`, `is_system` | System roles seeded per tenant |
| `sessions` | `user_id`, `token_hash`, `expires_at`, `ip`, `user_agent` |  |
| `api_keys` | `name`, `kind ENUM(secret, publishable)`, `key_hash`, `prefix`, `scopes TEXT[]`, `last_used_at`, `revoked_at` |  |
| `audit_log` | `actor_type`, `actor_id`, `entity_type`, `entity_id`, `action`, `diff JSONB`, `ip`, `request_id` | Append-only (no UPDATE/DELETE grants) |
| `categories` | `name`, `slug`, `parent_id`, `position`, `translations JSONB` |  |
| `products` | `type ENUM(rental, sale, service, consumable)`, `name`, `slug`, `description`, `translations JSONB`, `visibility`, `seo JSONB`, `tax_profile_id`, `deposit_amount`, `buffer_before_min`, `buffer_after_min`, `min_duration_min`, `max_duration_min`, `min_notice_min`, `increment_min`, `custom_fields` | `slug` unique per tenant |
| `product_categories` | `product_id`, `category_id` |  |
| `product_images` | `product_id`, `file_id`, `position`, `alt` |  |
| `variants` | `product_id`, `sku`, `name`, `options JSONB`, `tracking ENUM(serialized, bulk)`, `price_structure_id`, `deposit_amount`, `is_default` | `tracking` change blocked by trigger when open allocations exist |
| `stock_items` | `variant_id`, `location_id`, `barcode`, `serial`, `status ENUM(...)`, `condition`, `purchase_date`, `purchase_price`, `meter_value`, `notes`, `retired_at` | `barcode` unique per tenant |
| `stock_levels` | `variant_id`, `location_id`, `quantity INT CHECK (quantity >= 0)` | Unique `(variant_id, location_id)` |
| `stock_adjustments` | `variant_id`, `location_id`, `delta`, `reason`, `reference` | Ledger behind `stock_levels` |
| `temporary_stock` | `variant_id`, `location_id`, `quantity`, `period tstzrange`, `supplier`, `cost` | Sub-rentals |
| `bundles` | `product_id` (the bundle product), `pricing_mode ENUM(sum, fixed, discount_pct)` |  |
| `bundle_components` | `bundle_id`, `slot_name`, `variant_id`, `quantity`, `is_choice`, `position` |  |
| `allocations` | `variant_id`, `location_id`, `stock_item_id NULL`, `quantity`, `period tstzrange`, `kind ENUM(reservation, downtime, buffer, transfer)`, `order_line_id NULL`, `downtime_id NULL` | `EXCLUDE USING gist (stock_item_id WITH =, period WITH &&) WHERE (stock_item_id IS NOT NULL)`; GiST `(tenant_id, variant_id, location_id, period)`; `CHECK (quantity > 0)` |
| `downtimes` | `stock_item_id NULL`, `variant_id NULL`, `location_id`, `quantity`, `period`, `reason`, `maintenance_ticket_id NULL` | Creates an allocation of kind `downtime` |
| `price_structures` | `name`, `kind ENUM(fixed, per_period, tiered, table)`, `period_unit`, `rounding`, `charge_day_rules JSONB`, `tiers JSONB`, `table JSONB`, `currency` |  |
| `price_rules` | `name`, `kind ENUM(season, weekday, customer_group, volume, lead_time)`, `conditions JSONB`, `adjustment JSONB`, `priority`, `active` |  |
| `coupons` | `code`, `kind ENUM(percent, fixed)`, `value`, `scope JSONB`, `valid_period`, `max_uses`, `max_uses_per_customer`, `min_order`, `combinable`, `uses_count` | `code` unique per tenant (case-insensitive) |
| `tax_profiles` | `name`, `rates JSONB`, `inclusive` |  |
| `customers` | `type ENUM(person, company)`, `name`, `email`, `phone`, `company_name`, `tax_id`, `addresses JSONB`, `locale`, `tags TEXT[]`, `flags JSONB` (blocked, deposit\_waived, requires\_id\_check), `marketing_consent`, `notes`, `anonymized_at` | Trigram index on `name`, `email`, `phone` |
| `customer_contacts` | `customer_id`, `name`, `email`, `phone`, `role` |  |
| `customer_groups` / `customer_group_members` | `name`, `price_list` | B2B pricing |
| `orders` | `number` (per-tenant sequence), `status ENUM(...)`, `customer_id`, `location_id`, `starts_at`, `ends_at`, `timezone`, `currency`, `totals JSONB`, `payment_status` (generated), `deposit_policy JSONB`, `coupon_codes TEXT[]`, `terms_acceptance JSONB`, `source ENUM(storefront, admin, api)`, `quote_expires_at`, `notes JSONB`, `tags`, `custom_fields`, `closed_at`, `cancelled_at`, `cancel_reason` | `CHECK (ends_at > starts_at)`; `number` unique per tenant |
| `order_lines` | `order_id`, `type ENUM(rental, sale, service, fee, discount)`, `variant_id NULL`, `bundle_id NULL`, `parent_line_id NULL` (bundle children), `quantity`, `starts_at`, `ends_at`, `buffer_before_min`, `buffer_after_min`, `price_snapshot JSONB`, `unit_price`, `total`, `tax`, `description`, `position` |  |
| `order_line_units` | `order_line_id`, `stock_item_id`, `checked_out_at`, `checked_in_at`, `check_in_outcome ENUM(ok, needs_inspection, damaged, lost)` | Unique `(order_line_id, stock_item_id)` |
| `order_events` | `order_id`, `type`, `from_status`, `to_status`, `payload JSONB`, `actor` | Timeline |
| `documents` | `order_id`, `customer_id`, `type ENUM(quote, confirmation, contract, pick_list, delivery_note, invoice, credit_note, receipt)`, `number`, `issued_at`, `status`, `file_id`, `data JSONB` (frozen content), `template_id`, `template_version`, `voided_by_id` | Trigger forbids UPDATE after `issued_at` except `status`/`voided_by_id`; gap-free `number` via `document_sequences` with row lock |
| `document_sequences` | `type`, `year`, `prefix`, `next_value` |  |
| `document_templates` | `type`, `name`, `locale`, `body`, `css`, `version`, `is_default` |  |
| `signatures` | `document_id`, `signer_name`, `signer_email`, `method ENUM(click, drawn, typed)`, `image_file_id`, `document_hash`, `ip`, `user_agent`, `signed_at`, `otp_verified` |  |
| `payment_providers` | `plugin_id`, `config JSONB` (encrypted), `mode ENUM(test, live)`, `enabled` |  |
| `payments` | `order_id`, `provider_id`, `kind ENUM(charge, authorization, refund, manual)`, `method`, `amount`, `currency`, `status ENUM(pending, succeeded, failed, cancelled)`, `provider_ref`, `provider_event_id`, `idempotency_key`, `parent_payment_id` | `provider_event_id` unique per provider |
| `payment_intents` / `payment_links` | `order_id`, `amount`, `status`, `provider_ref`, `expires_at`, `url` |  |
| `deposits` | `order_id`, `amount`, `method ENUM(card_auth, charge, cash, waived)`, `status ENUM(pending, held, partially_captured, captured, released, expired, failed)`, `payment_id`, `authorized_at`, `expires_at`, `captured_amount`, `released_at` |  |
| `damage_charges` | `order_id`, `stock_item_id NULL`, `description`, `amount`, `tax`, `status ENUM(open, captured, invoiced, waived)`, `deposit_id NULL`, `document_id NULL`, `photos UUID[]` |  |
| `maintenance_tickets` | `title`, `status`, `priority`, `assignee_id`, `due_at`, `cost`, `resolution`, `downtime_id` |  |
| `maintenance_ticket_items` | `ticket_id`, `stock_item_id` |  |
| `inspection_templates` / `inspections` | `category_id`, `items JSONB`; `stock_item_id`, `order_id NULL`, `results JSONB`, `passed`, `photos` |  |
| `deliveries` | `order_id`, `kind ENUM(delivery, collection)`, `address JSONB`, `window tstzrange`, `status`, `driver_id`, `proof JSONB` |  |
| `notification_templates` | `event`, `channel`, `locale`, `subject`, `body`, `enabled` |  |
| `notifications` | `channel`, `template_id`, `recipient`, `order_id NULL`, `status ENUM(queued, sent, delivered, bounced, failed)`, `provider_ref`, `error` |  |
| `webhook_endpoints` | `url`, `events TEXT[]`, `secret_hash`, `previous_secret_hash`, `secret_rotated_at`, `status`, `api_version` |  |
| `webhook_events` | `type`, `payload JSONB`, `actor JSONB`, `request_id` | Outbox source |
| `webhook_deliveries` | `endpoint_id`, `event_id`, `attempt`, `status`, `response_code`, `response_body`, `next_attempt_at` |  |
| `outbox` | `aggregate_type`, `aggregate_id`, `event_type`, `payload`, `published_at NULL` | Written in the domain transaction |
| `files` | `key`, `bucket`, `content_type`, `size`, `sha256`, `kind`, `owner_type`, `owner_id` |  |
| `custom_field_definitions` | `entity ENUM(product, variant, stock_item, order, customer)`, `key`, `label`, `type ENUM(text, number, boolean, date, select, multiselect, url)`, `options JSONB`, `required`, `position` | Unique `(entity, key)` |
| `jobs` (pg-boss schema) | managed by pg-boss |  |
| `plugins` | `plugin_id`, `version`, `enabled`, `config JSONB` (encrypted) |  |

### 8.2 Key relationships

- `products 1—n variants 1—n stock_items`; `variants 1—n stock_levels` (per location).
- `orders 1—n order_lines 1—n order_line_units n—1 stock_items`; `order_lines 1—n allocations`.
- `orders 1—n documents`, `payments`, `deposits`, `damage_charges`, `deliveries`, `order_events`.
- `bundles 1—n bundle_components`; bundle order lines have child lines via `parent_line_id`.
- `maintenance_tickets 1—1 downtimes 1—1 allocations(kind=downtime)`.

### 8.3 Invariants enforced in the database

| Invariant | Mechanism |
| --- | --- |
| No overlapping allocations per stock item | Exclusion constraint on `allocations` |
| Bulk pool never oversold | Serialisable transaction + advisory lock in `availability.reserve`; nightly consistency check job |
| Stock level never negative | `CHECK (quantity >= 0)` |
| Issued documents immutable | Trigger `documents_immutable` |
| Gap-free invoice numbers | `document_sequences` row locked `FOR UPDATE` in the issuing transaction |
| Tenant isolation | RLS on every table; app role without `BYPASSRLS` |
| Audit completeness | Service layer writes `audit_log` in the same transaction; a trigger-based fallback captures direct SQL changes |
| Price snapshots immutable | `order_lines.price_snapshot` only writable while order is `draft`/`quote` (trigger) |

## 9. Non-functional requirements

| Category | Requirement | Verification |
| --- | --- | --- |
| Performance | API p95 < 200 ms for single-resource reads, < 400 ms for list endpoints (50 items) at 10k orders/tenant; availability query (1 variant × 90 days, 10k units) p95 < 100 ms; `price_quote` p95 < 50 ms; storefront TTFB < 300 ms p95, LCP < 2.5 s on 4G | k6 load tests in CI nightly against seeded data; Lighthouse CI on storefront |
| Scale targets (1.0) | 100k orders, 50k stock items, 20k customers per tenant; 1,000 tenants per hosted cluster; 200 concurrent back-office users per tenant | Benchmark suite |
| Availability (uptime) | Stateless `api`/`worker` for horizontal scaling; zero-downtime deploys (expand/contract migrations); graceful shutdown drains jobs | Deployment runbook, chaos test |
| Reliability | Idempotency on all POSTs and payment webhooks; transactional outbox; job retries with dead-letter queue and alerting; daily reconciliation of payments and availability | Integration tests, DLQ dashboard |
| Security | OWASP ASVS Level 2; Argon2id; TOTP; session fixation protection; CSRF; strict CSP on admin and storefront; SSRF protection on webhook URLs; secrets encrypted at rest (AES-256-GCM with `OPENRENT_ENCRYPTION_KEY`); dependency scanning (OSV, Dependabot); SBOM (CycloneDX) per release; signed container images (cosign); `SECURITY.md` with 90-day disclosure | ZAP baseline scan in CI, annual external pentest for hosted |
| Payment compliance | No card data touches OpenRent (provider-hosted fields/iframes) → PCI SAQ-A; provider credentials encrypted; test/live mode separation | Review per provider plugin |
| Privacy | GDPR: data export, erasure/anonymisation, retention policies (configurable per entity), consent flags, processing log; no third-party calls from storefront without consent; telemetry opt-in only, anonymous | DPIA template in docs |
| Multi-tenancy isolation | RLS on all tables; per-request tenant context; storage key prefixes per tenant; tenant-scoped rate limits; cross-tenant access tests | Automated isolation test suite |
| Internationalisation | All UI strings externalised (paraglide); ICU plurals; locale-aware dates, numbers, currency; RTL layout support; tenant-level translations for product content, templates and emails; launch locales en, nl, de, fr, es, et | Pseudo-localisation build in CI |
| Time zones | Store UTC + IANA zone; all period maths in the location's zone; DST-safe (periods as `tstzrange`) | Property tests across DST boundaries |
| Accessibility | WCAG 2.2 AA on admin, storefront and widget | axe-core in component tests and Playwright; manual audit per minor release |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari (desktop and iOS); widget also supports Safari 15+ | Playwright matrix |
| Offline (PWA) | Admin scan screens usable offline with queued actions; storefront not required offline | Manual test protocol |
| Observability | OpenTelemetry traces across api → db → worker; RED metrics per endpoint; business metrics (orders/day, utilisation) exposed; structured JSON logs with request/tenant IDs; `/system/health`, `/system/ready` | Grafana dashboards shipped in `deploy/` |
| Maintainability | Modular monolith with enforced dependency graph; ≥ 80% line coverage in `packages/core`, 100% branch coverage on availability and pricing; ADRs in `docs/adr/`; conventional commits | CI gates |
| Documentation | Every endpoint documented in OpenAPI with examples; admin user guide; self-hosting guide; plugin author guide; CHANGELOG from Changesets | Docs build in CI; broken-link check |
| Upgradability | SemVer; migrations always forward and reversible for one version; `openrent migrate` CLI with `--dry-run`; LTS branch yearly with 18 months of security fixes | Upgrade test from N-1 in CI |
| Portability | Runs on Linux amd64/arm64; only hard dependency is PostgreSQL 16+ and S3-compatible storage; no cloud-specific services | Compose on Raspberry Pi 5 smoke test |
| Licensing hygiene | Core deps must be MIT/Apache/BSD/ISC compatible with AGPL distribution; no proprietary assets (icons, fonts) in the core | License check in CI (`license-checker`) |

## 10. Deployment and operations

The default install is one `docker compose up` with five containers: `caddy`, `api`, `worker`, `postgres`, `minio`. Everything else is optional.

### 10.1 Docker Compose (reference)

```yaml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data"]
  api:
    image: ghcr.io/openrent/api:1
    env_file: .env
    depends_on: [postgres, minio]
    command: ["node", "dist/server.js"]
  worker:
    image: ghcr.io/openrent/api:1
    env_file: .env
    depends_on: [postgres, minio]
    command: ["node", "dist/worker.js"]
  postgres:
    image: postgres:16
    environment: { POSTGRES_DB: openrent, POSTGRES_USER: openrent, POSTGRES_PASSWORD: ${DB_PASSWORD} }
    volumes: ["pg_data:/var/lib/postgresql/data"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes: ["minio_data:/data"]
volumes: { pg_data: {}, minio_data: {}, caddy_data: {} }
```

The `api` image also serves the built admin SPA and storefront SSR (Caddy routes `/admin*` and `/api*` to `api`, everything else by host to the storefront handler in the same process). Operators who prefer separate processes run `apps/storefront` as its own container.

### 10.2 Configuration (environment variables)

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection (app role, not superuser) | required |
| `DATABASE_MIGRATION_URL` | Role allowed to run migrations | = `DATABASE_URL` |
| `OPENRENT_PUBLIC_URL` | Base URL for admin and API | required |
| `OPENRENT_STOREFRONT_DOMAIN` | Wildcard host for tenant storefronts (`*.rent.example.com`) | optional |
| `OPENRENT_ENCRYPTION_KEY` | 32-byte base64 key for secrets at rest | required |
| `OPENRENT_SESSION_SECRET` | Cookie signing | required |
| `OPENRENT_MODE` | `single_tenant` or `multi_tenant` | `single_tenant` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | File storage | required |
| `SMTP_URL` | `smtp://user:pass@host:587` | optional (emails queued but not sent) |
| `REDIS_URL` | Optional cache/rate-limit store | none (in-Postgres) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Telemetry | none |
| `PLUGINS_DIR` | Directory of installed plugins | `/plugins` |
| `LOG_LEVEL` | pino level | `info` |
| `TRUST_PROXY` | Honour `X-Forwarded-*` | `true` |

All variables are documented in `.env.example` and validated at boot with a clear error listing missing or malformed values.

### 10.3 First run

1. `cp .env.example .env` and fill required values (a `scripts/gen-secrets.sh` generates keys).
2. `docker compose up -d` → `api` runs migrations automatically on first boot (configurable with `AUTO_MIGRATE=false`).
3. Open `/admin/setup`: create the owner account, tenant name, currency, timezone, first location. The wizard offers demo data (20 products, 60 stock items, 30 orders) that can be removed later.
4. Connect Stripe (test mode) and SMTP from Settings; send a test email; run the "first booking" checklist in the dashboard.

### 10.4 Migrations

- Plain SQL files in `packages/db/migrations/NNNN_name.sql` with a paired `.down.sql`; applied by `openrent migrate` (Drizzle migrator) with advisory lock to prevent concurrent runs.
- Expand/contract discipline: additive migration → deploy code reading both → contracting migration in the next release. No column drops in the same release as the code change.
- Every migration has a test that runs it against the N-1 release's schema with seed data.

### 10.5 Backups and restore

- Documented `pg_dump --format=custom` nightly + WAL archiving guidance; `openrent backup` CLI bundles a DB dump and a storage manifest; `openrent restore` verifies checksums.
- Tenant-level export (`POST /tenant/export`) produces a portable ZIP (JSON + CSV + documents) independent of the backup.
- Restore drill documented and tested quarterly for the hosted service.

### 10.6 Operations runbook (shipped in `docs/`)

- Health: `/system/health` (process), `/system/ready` (DB, storage, queue depth); Grafana dashboards for RED metrics, queue depth, webhook failure rate, deposit expiry forecast.
- Alerts: job DLQ > 0, webhook endpoint auto-disabled, payment reconciliation mismatch, availability consistency check failure, disk > 80%.
- Scaling: add `api` replicas behind Caddy; add `worker` replicas (pg-boss handles distribution); Postgres read replica for reports in V1.
- Upgrades: `docker compose pull && docker compose up -d`; release notes flag migrations requiring downtime (target: none).
- Hosted mode additions: tenant signup, custom domain verification (DNS TXT), automatic TLS via Caddy on-demand, per-tenant usage metering.

### 10.7 Developer environment

- `pnpm i && pnpm dev` starts Postgres and MinIO via Compose, runs migrations, seeds demo data, starts api, worker, admin and storefront with hot reload, and `mailpit` for email preview.
- `pnpm test` (unit + integration with Testcontainers), `pnpm e2e` (Playwright), `pnpm openapi` (regenerate spec and SDK, fails if the spec changed without a changeset).
- Devcontainer and GitHub Codespaces config so a contributor can run the stack in the browser.

## 11. Roadmap, milestones and definition of done

Four milestones take the project from foundations to an ecosystem over 18 months, starting November 2026. Each milestone has a gate that must pass before the next starts.

&#91;embedded content: roadmap · 4 milestones, 3 gates, Nov 2026 to Apr 2028\]

Each gate must pass before the next milestone starts; the 1.0 release in November 2027 is the one date external partners should plan around.

### 11.1 Milestones

| Milestone | Window | Scope | Gate |
| --- | --- | --- | --- |
| M0 Foundations | Nov 2026 – Jan 2027 | Repo, CI, licence, ADRs; `packages/db` schema with RLS and allocation constraints; `packages/core` availability + pricing engines with property tests; auth and tenancy; OpenAPI skeleton and SDK generation; Compose dev stack; design tokens and base components | Availability concurrency test (100 parallel, 1 winner) green; `docker compose up` to login works on amd64 and arm64 |
| M1 MVP (public alpha) | Feb – Jun 2027 | All MVP requirements in Section 3: catalogue, bulk + serialised + bundles, order lifecycle with scan check-out/in, documents (PDF), Stripe payments and deposits, customers, hosted storefront + widget, labels and scanning, email notifications, core reports, full REST API + webhooks, en/nl/de/fr/es/et | Three pilot shops run live for 30 days; zero double-bookings; API coverage audit = 100% of UI actions |
| M2 V1 (beta → 1.0) | Jul – Nov 2027 | Multi-location UI and transfers, custom roles, OIDC, e-signature, price rules and fees, inspections and damage → deposit capture, maintenance tickets, deliveries, customer portal, B2B accounts, Xero/QuickBooks, Mollie/PayPal plugins, plugin system v1, offline scan queue, Helm chart, managed cloud beta | 1.0 release; 50 production installs; external security review passed; docs complete |
| M3 Ecosystem | Dec 2027 – Apr 2028 | Segment packs (AV containers and sub-rentals; construction meters and PO billing; Library of Things memberships); WordPress plugin and Shopify app; e-invoicing plugins; importers (Booqable, Snipe-IT, Shelf); BI views; OAuth apps; LTS branch. The plugin and theme directory and marketplace are deferred (ADR 0013) | Every requirement built except the deferred ones; first LTS cut. Market goals: 20 community plugins (published on npm), 25 regular contributors |

### 11.2 Definition of done (per feature)

- [ ] OpenAPI spec updated with descriptions and examples; SDK regenerated; changeset added
- [ ] Service implemented in `packages/core` with unit tests; DB migration with up/down and N-1 test
- [ ] Integration test against Postgres covering success, validation error and conflict paths
- [ ] Webhook events emitted and listed in the event catalog
- [ ] Audit log entries for every mutation
- [ ] Admin UI implemented with keyboard access, axe test and Storybook story; storefront UI where applicable
- [ ] Strings externalised and present in all launch locales (machine draft acceptable, flagged for review)
- [ ] Permissions mapped and tested for each role
- [ ] Docs page updated (user guide and/or API guide)
- [ ] Reviewed by one maintainer outside the authoring team

### 11.3 Success metrics

| Metric | M1 (Jun 2027) | M2 (Nov 2027) | M3 (Apr 2028) |
| --- | --- | --- | --- |
| Production installs (opt-in telemetry + hosted tenants) | 10 | 300 | 1,500 |
| GitHub stars | 500 | 1,500 | 4,000 |
| Monthly active contributors | 5 | 10 | 25 |
| Community plugins | 0 | 5 | 20 |
| Median install → first booking | < 90 min | < 60 min | < 30 min |
| Double-booking incidents attributable to the engine | 0 | 0 | 0 |
| API coverage of UI actions | 100% | 100% | 100% |
| Webhook delivery success within 1 h | 99% | 99.5% | 99.9% |
| Hosted cloud MRR | — | covers 2 FTE | covers 4–5 FTE |

### 11.4 Team and cadence

- Core team for M0–M2: 1 tech lead, 2 backend (Node/Postgres), 2 frontend (Svelte), 1 designer (part-time), 1 docs/community (part-time).
- Two-week iterations; monthly minor releases; weekly public community call from M1; public roadmap board; RFC process for anything touching the data model, API contract or plugin API.

## 12. Licensing, governance, risks and open decisions

### 12.1 Licensing

| Component | Licence | Reason |
| --- | --- | --- |
| Core (`apps/api`, `apps/worker`, `apps/admin`, `apps/storefront`, `packages/core`, `packages/db`) | AGPL-3.0-only | Prevents closed hosted forks; standard in this niche (Snipe-IT, Shelf.nu, Louez, AdamRMS) |
| `packages/sdk`, `apps/widget`, `packages/plugin-sdk`, `packages/api-spec` | Apache-2.0 | Merchants embedding the widget and developers writing plugins or clients take on no AGPL obligations |
| First-party plugins | AGPL-3.0-only (may be relicensed per plugin) | Consistent with core |
| Documentation | CC BY 4.0 |  |
| Trademark "OpenRent" and logo | Held by the project entity; usage policy published | Protects the name while code stays free |

Contributions are accepted under a Developer Certificate of Origin (`Signed-off-by`), not a CLA. No dual licensing is planned; if it is ever proposed it requires an RFC and consent of contributors.

### 12.2 Governance

- **Phase 1 (M0–M2):** maintainer team of the founding contributors; decisions by lazy consensus on GitHub, escalated to the tech lead. `GOVERNANCE.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md`, `CONTRIBUTING.md` published at M0.
- **Phase 2 (after 1.0 or when ≥ 3 organisations contribute regularly):** elected steering committee (5 seats, 1-year terms, max 2 from one employer); RFC process for data model, API and plugin-API changes with a 14-day comment period.
- **Legal home:** a non-profit association (e.g. Estonian MTÜ or a fiscal host such as Open Collective) holds the trademark and donations.
- **Sustainability:** managed cloud, support contracts, and onboarding services fund maintainers. Every feature stays in the AGPL core; the cloud sells convenience, not features.
- **Transparency:** public roadmap, monthly changelog post, public incident reports for the hosted service.

### 12.3 Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Deposit card authorisations expire before long rentals end (Stripe \~7 days; Visa \~5; in-person Mastercard/Amex 2; PayPal 10–20) | High | Medium | Provider abstraction exposes `authorization_window`; tenant policy (re-auth, convert to charge, notify); `deposit.expiring` event; documented per provider |
| Availability engine performance at scale (large bulk pools, long ranges) | Medium | High | GiST indexes, boundary-sweep query, benchmark in CI, optional time-bucket cache behind a feature flag |
| Serialisable transaction retry storms on hot variants | Medium | Medium | Advisory lock per `(variant, location)`; bounded retries; metrics |
| Scope creep toward ERP/crew features | High | Medium | Non-goals in Section 1.3; plugin route; RFC gate |
| Fragmentation with Louez / AdamRMS | Medium | Medium | Open conversation with maintainers before M1; shared plugin interfaces where possible; importers |
| Tax and invoicing compliance across countries | High | High | Pluggable `TaxProvider`; start with EU VAT (incl. OSS) and basic US sales tax; community country packs; invoice immutability and gap-free numbering as core |
| PDF rendering cost (Chromium) in worker | Medium | Low | Worker-only, pooled browser, cached templates; fallback to `@react-pdf`-style renderer later if needed |
| Camera scanning reliability on iOS Safari | Medium | Medium | ZXing fallback, HID scanner support, QR preferred over Code128 for small labels |
| Maintainer burnout | Medium | High | Funding via hosted service; clear governance; LTS cadence limits support load |
| Security incident in a self-hosted install due to misconfiguration | Medium | High | Secure defaults, boot-time config validation, hardening guide, `openrent doctor` command |

### 12.4 Open decisions

| # | Decision | Options | Recommendation | Owner / due |
| --- | --- | --- | --- | --- |
| 1 | Build new vs fork/contribute to Louez or AdamRMS | New core; fork Louez; contribute engine upstream | Talk to both maintainer teams before M0 ends; default to new core with shared plugin interfaces | Tech lead, Dec 2026 |
| 2 | Bulk availability algorithm | On-the-fly boundary sweep; time-bucket occupancy table | Sweep first, buckets behind flag if benchmarks fail | Backend, M0 |
| 3 | Storefront: part of `api` process or separate service | Same process; separate container | Same process by default, separable | Tech lead, M0 |
| 4 | ID verification provider for V1 | Stripe Identity; Veriff; none | Defer to plugin after 1.0 | Product, M2 |
| 5 | Hosted cloud pricing model | Flat per tenant; usage-based; per location | Flat per tenant with fair-use limits (no per-seat fees) | Steering, M2 |
| 6 | Project name and trademark | OpenRent; alternatives | Trademark search before M0 public announcement | Community lead, Nov 2026 |
| 7 | Mobile scanning: PWA only or native wrapper | PWA; Capacitor wrapper | PWA for 1.0; Capacitor if iOS Bluetooth scanning blocks pilots | Frontend, M1 |
| 8 | Public plugin and theme directory, signing and marketplace billing (FR-PLG-10, FR-PLG-11, FR-THM-11) | Build in M3; defer | Deferred (decided 2026-10-27): segment packs, documents and identity, data views, OAuth apps and the embeds come first (ADR 0013) | Maintainers, after the first LTS |

### 12.5 References

- Market and competitor research summarised in the companion report (Booqable pricing and features, Rentman, Current RMS, HireHop, EZRentOut, Point of Rental, Quipli, Twice, Sharefox, Goodshuffle Pro; open-source landscape: Louez, AdamRMS, OpenRental, RentalCore, Shelf.nu, Snipe-IT, Odoo/OCA, WooCommerce plugins).
- PostgreSQL range types and exclusion constraints; RFC 9457 Problem Details; OpenAPI 3.1; WCAG 2.2.
