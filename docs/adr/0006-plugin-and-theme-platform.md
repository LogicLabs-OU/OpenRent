# ADR 0006: Plugin and theme platform

Status: accepted

The plan reserved 0006 for availability (Phase 2) and 0007 for this platform. Phase 1 finished first, so this record takes 0006 and the availability record becomes 0007.

## Trust model

- Plugins run inside the OpenRent process. Installing a plugin means trusting its code, the same as installing any server package. The guard rails below stop mistakes, not attackers.
- Upload from the admin is off unless the operator sets `OPENRENT_ALLOW_PLUGIN_UPLOAD=true`, and then only the shop owner may install. The owner sees the plugin's requested permissions and manifest warnings before confirming. The plugin loads at the next restart.
- `openrent plugin disable <id>` turns a plugin off for every shop without starting the API, for a plugin that breaks.

## Plugin manifest and loading

- `openrent.plugin.json` describes a plugin without running it: id, version, `compat` (plugin API range), permissions, settings, admin bundles, schedules, migrations folder and admin texts. `validateManifest` in `@openrent/plugin-sdk` is shared by the host, the upload check and `openrent plugin check`.
- Errors stop a plugin from loading. Unknown and deprecated keys are warnings, shown on the plugins page.
- Plugin API is 1.1.0. 1.0 plugins keep working.

## What a plugin can reach (scope)

Hooks, routes, event handlers and schedules get `ctx.scope`, built per plugin:

- `db.query`: the shop's data under row-level security, inside the caller's transaction, wrapped in a savepoint so a failing plugin query never aborts the core operation. Reads may touch any table. Writes (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, also inside CTEs) only to `plg_<id>_` tables. Session settings (`set_config`, `SET ROLE`), schema changes, transaction control and multiple statements are refused.
- `services`: read-only orders, customers and products in API shape.
- `config()` and `secrets.get()`: the plugin's own settings for the shop.
- `events.emit`: only `plugin.<id>.<name>` events, which reach webhooks like core events.

## Plugin migrations

- SQL files run after OpenRent's migrations, recorded in `plugin_migrations` with a checksum. A changed file is reported, not re-run.
- A static check accepts only `CREATE/ALTER/DROP TABLE`, `CREATE INDEX`, `INSERT` and `COMMENT` on the plugin's own `plg_<id>_` names. Every new table needs `tenant_id text NOT NULL`; the invariants then give it row-level security like core tables. Functions, triggers, policies, roles, grants and `DO` blocks are refused.

## Hooks and providers

- New hooks: `documents.render` (before; may add data to the frozen document), `payments.record` (before for staff payments, may veto; after for every succeeded payment) and `checkout.complete` (before; may veto a storefront order).
- New provider kinds: tax (rates per line before pricing; the engine is unchanged, a failing service falls back to the shop's rates), identity (pickup waits until a customer marked "requires ID check" is verified; staff can also tick "ID checked"), search (storefront search; falls back to built-in search) and signatures (interface for Phase 2).
- `api.schedule(name, cron, handler)` runs per shop that has the plugin on, through pg-boss queues `plugin.<id>.<name>`, isolated like hooks with a one-minute limit.

## Extension points

- Admin: plugins declare custom elements per outlet (order sidebar, product, customer, dashboard, settings, navigation, scan). The admin loads the bundle once, sets the page context as the `context` property and shows a notice if the bundle fails. Bundles in a plugin folder are served from `/api/v1/plugins/{id}/ui/{file}`, only when declared.
- Storefront: declarative only. Checkout fields (stored on the order as `plg_<id>_<key>` custom fields), product badges by tag, and scripts that load only after the visitor's consent (their origins are added to that shop's CSP). Themes need no code: the existing `checkout.extra_fields` and `product.before_add` slots render them.

## Developer kit

- `create-openrent-plugin` scaffolds a plugin that passes `openrent plugin check`; `openrent plugin pack` makes the ZIP the admin accepts.
- `@openrent/plugin-testing` starts a throwaway shop (PGlite plus the real API) with the plugins under test registered and migrated. It is a separate AGPL package rather than `@openrent/plugin-sdk/testing`, so the Apache-2.0 SDK does not depend on the AGPL server.

## Themes

- Code themes compile into the storefront. The list comes from the virtual module `virtual:openrent-themes`: packages in `themes.json` plus every theme folder in `THEMES_DIR` (`openrent theme install` puts them there). Adding one needs a storefront rebuild. The API reads the same folders for the admin.
- Child themes (`"extends": "<code theme>"` in theme.json) are data: default settings, home layout, texts, CSS and assets. A shop uploads them in the admin and they work at once, rendered by the parent's code. Uploads are checked (file allowlist, JSON, parent installed) and the owner sees which files change and which saved settings would be dropped before confirming. Their assets become public files with immutable URLs; `url(assets/…)` in their CSS is rewritten to them.
- Code theme assets are served by the storefront at `/themes/{id}/assets/{name}.{hash}.{ext}`, cached for a year. Themes call `rt.asset(path)` (theme API 1.4) for either kind.
- `openrent theme check` validates theme.json and data files, lints imports (themes may import Svelte, the theme SDK, the UI kit and its companions, icons and their own files; no Node, server or SvelteKit modules, no direct network calls) and compares languages with English. CI runs it on the bundled themes. `create-openrent-theme` scaffolds a child theme.
- Not done: a worker job that rebuilds the storefront when a code theme is uploaded (`OPENRENT_THEME_BUILDS`), and `openrent theme dev` with mock data. Operators rebuild the image instead.

## Shop wording

- `string_overrides` holds a shop's own text per namespace (storefront, `theme:<id>`, `plugin:<id>`, email, documents), language and key. Placeholders and plural blocks must match the built-in text (`shapeProblem` in `@openrent/i18n`, also used by `check-i18n`).
- Theme texts merge on top of the older per-theme overrides; storefront texts reach the theme runtime's fallback; emails and documents render inside `withStrings`, so `{{t "…"}}` and the built-in templates use the shop's wording; plugin bundles fetch their merged catalogue.
