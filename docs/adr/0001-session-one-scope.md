# ADR 0001: Scope of the first MVP slice

Date: 2026-10-24 · Status: accepted

## Context

The PRD sizes M0 (foundations) and M1 (MVP) for a seven-person team over eight months. The first build session targets
a vertical slice through every layer, so later work extends a running system instead of assembling layers at the end.

## Decision

Build every layer of the PRD architecture (§7) with the invariants of §8.3 enforced in PostgreSQL, and a working subset
of each functional area. Dependencies are installed with pnpm at their latest versions. TypeScript is pinned to the
6.x line because TypeScript 7 ships no compiler API, which svelte-check, typescript-eslint and openapi-typescript need.

## In this slice

Tenancy with RLS, users and fixed roles, TOTP, magic links, API keys; catalogue with serialised, bulk and bundle products;
the availability engine; the pricing engine; the full order state machine; manual and Stripe payments, deposits, damage;
documents; notifications; REST API with OpenAPI; signed webhooks; worker jobs; back office; storefront with a theme;
widget; Stripe and SMTP plugins; Docker Compose.

## Simplified or deferred (next sessions)

| PRD item | Now | Next step |
| --- | --- | --- |
| Drizzle ORM (§7.1) | Hand-written SQL migration and parameterised `pg` queries | Generate Drizzle schema from the migration for typed queries |
| paraglide-js i18n, 6 locales (FR-I18N) | Typed message helper with an English catalogue in the admin; theme locales with fallback; `translations` JSONB on products and categories | Adopt paraglide, externalise all strings, add nl/de/fr/es/et |
| shadcn-svelte / bits-ui components | Done: shadcn-svelte components live in `packages/ui` and are used by admin, storefront theme and widget. `packages/ui/src/theme.css` holds the CSS variables (scoped to `:root` and `:host`) and replaces the old tokens package | Storybook and axe tests |
| Files and S3 / MinIO, product images | No object storage; documents stored as HTML in PostgreSQL | Storage provider plugin, image uploads |
| PDF rendering | `PDF_RENDERER=playwright` optional; otherwise print HTML | Pooled Chromium in the worker |
| Theme ZIP upload, theme directory, section editor, theme CLI (FR-THM-3/5/9) | Themes are workspace packages validated at start-up | Upload and compile at install, visual editor, `openrent theme` CLI |
| Plugin ZIP install, admin UI slots, plugin migrations (FR-PLG-2/4/5) | Plugins listed in `plugins.json`; hooks, providers, routes, events | Install flow, slot outlets in the admin, `plg_*` migrations |
| CSV/XLSX import (FR-CAT-8), tenant export to S3 (FR-MIG-1) | JSON export download | Import wizard with dry run |
| Variant and calendar planner (FR-AV-9, §4.2.6) | Month availability grid per variant | Unit timeline with drag to reassign |
| Customer contacts, custom field definitions | Custom fields stored as JSON without definitions | Definitions with validation |
| Choice bundles, sub-rentals, multi-location UI | Data model only for locations | V1 |
| Offline scan queue, Helm, OIDC, custom roles, e-signature | — | V1 per PRD |
| Distroless images | `node:24-slim` runtime, non-root | Switch to distroless after a verified image build |

## Consequences

The domain core, API contract and database invariants are in their intended shape, so the deferred items add surface
without reworking foundations. Because the availability and pricing code is the riskiest, it carries the most tests.
