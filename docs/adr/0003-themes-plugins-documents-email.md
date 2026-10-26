# ADR 0003: Theme and plugin management, PDFs, email and storefront payment

Status: accepted

## Migrations

- `packages/db/src/schema.ts` is the Drizzle schema. It was introspected from `0001_init.sql`; the pull's commented baseline and snapshot live in `packages/db/migrations`. `pnpm db:generate --name x` writes timestamped migrations next to `0001_init.sql`, which sorts first.
- The first generate re-created three expression indexes because drizzle-kit formats them differently from introspection. The result is equivalent, so it was kept.
- `packages/db/sql/invariants.sql` runs after every migrate: RLS, `FORCE`, the `tenant_isolation` policy and grants for every table with a NOT NULL `tenant_id`, and `updated_at` triggers. New tables need no hand-written security SQL.
- Generated migrations are forward-only. Rollback refuses migrations without a `.down.sql`. The integration harness drops and recreates the test schema instead of rolling back.

## Plugins

- Per-tenant enablement and settings live in the existing `plugins` table. Non-secret values are plain JSON; `secret` fields are sealed with `OPENRENT_ENCRYPTION_KEY` under `__sealed` and never returned by the API.
- Effective config = installation defaults (env, via `setDefaultConfig`) overridden by tenant values.
- Hooks and event handlers skip plugins a tenant disabled. The host keeps a snapshot of disabled pairs, refreshed every 15 s and after each change, so no hook waits on a database query inside a request.
- Installing new plugin code still means adding it to `plugins.json` and restarting. Upload from the admin is not built: running uploaded code needs signing and an operator-only path first.

## Themes

- Installed themes are listed in `themes.json`. The API reads their JSON parts (manifest, settings schema, locales); the storefront compiles their Svelte templates. Runtime ZIP install is not built because templates must be compiled with the storefront.
- Tenant data: `theme.id` (live), `theme_settings[id]` and `theme_translations[id][locale]` in tenant settings, so switching themes keeps each one's customisation.
- Preview links carry an HMAC-signed token (tenant, theme, 1 hour expiry) keyed by `OPENRENT_SESSION_SECRET`. The storefront keeps it in a session cookie and forwards it as `X-Theme-Preview`; such responses are `no-store`.
- Theme API is now 1.1.0 (optional `payOrder`, `payable`, `payment_result`), still compatible with `^1.0.0` themes.

## Documents and email

- PDFs are rendered with Playwright Chromium (JavaScript off, only `https:` and `data:` resources) and stored once in `files` (bytes in Postgres by default; a `StorageProvider` plugin can store them elsewhere). Issued documents are immutable, so the stored PDF never goes stale.
- A worker job pre-renders PDFs of documents issued in the last 7 days; downloads and email attachments render on demand otherwise. A missing Chromium never blocks an email.
- `notifications.attachments` lists document ids; confirmation and quote emails attach their document.
- Each shop configures SMTP through the `notify-smtp` plugin settings; `SMTP_URL` stays the installation default.
- Delivery: failed sends are retried after 1, 5, 15, 30, 60, 120, 240 and 480 minutes, then marked `failed`; refused recipients fail at once and messages older than 7 days are given up. Channels throw `DeliveryError` with a cause code (`tls_mismatch`, `auth_failed`, …) that core turns into a readable message. Saving email plugin settings sends every waiting message straight away. Staff can view, send now, send again or cancel any message from Settings → Email.

## Storefront payment

- After the payment page redirects back, the storefront calls `POST /storefront/orders/{id}/payments/sync`, which asks the provider (`retrievePayment`) for the intent state and applies it as an event with a stable id. The booking confirms even if the webhook is late; the webhook then deduplicates.
- Unpaid storefront orders show a pay button on the confirmation page.

## Not done

- Theme ZIP upload, section editor, theme update diffs, the developer CLI (FR-THM-5, -8, -9).
- Plugin upload, plugin migrations, admin UI slots rendering (FR-PLG-2 upload, -4, -5).
- Backend messages from before this change are still English strings; new server messages use `packages/core/src/i18n`.
- Real Stripe and real PostgreSQL were not exercised in this session; Docker images were not built (Chromium is installed in the API and worker stages).
