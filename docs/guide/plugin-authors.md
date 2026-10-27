# Writing a plugin

A plugin adds a provider (payments, email, tax…), reacts to what happens in a shop, or extends the admin and the storefront. Plugins are written against `@openrent/plugin-sdk`, which is Apache-2.0: your plugin takes on no AGPL obligations.

Plugins run inside the OpenRent process. The limits below catch mistakes; they are not a sandbox. Installing a plugin means trusting its code.

## Start a plugin

```sh
npx create-openrent-plugin site-access --name "Site access"
cd site-access
npm install
npm test
```

You get `openrent.plugin.json`, `index.js`, a migration, an admin bundle, a test and a README. The result passes `openrent plugin check` as it is.

## definePlugin

A plugin is a default export. `definePlugin` only adds types:

```ts
import { definePlugin, HookVeto } from '@openrent/plugin-sdk';

export default definePlugin({
  id: 'site-access',
  name: 'Site access',
  version: '0.1.0',
  author: 'You',
  license: 'MIT',
  compat: '^1.8.0',
  permissions: ['orders:read', 'db:own_tables', 'events:emit', 'network'],
  settings: [
    { key: 'api_token', label: 'Access system token', type: 'secret', required: true },
    { key: 'notice_hours', label: 'Hours of notice', type: 'number', default: 24 },
    { key: 'closed_sites', label: 'Sites closed for deliveries (comma separated)', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['codes', 'cards'] },
  ],
  setup(api) {
    api.logger.info({ plugin: 'site-access' }, 'loaded');
  },
});
```

- `id`: 2–40 lowercase letters, digits or dashes, starting with a letter.
- `version`: a semantic version.
- `compat`: the plugin API versions you support (see [Versions](#plugin-api-versions)).
- `permissions`: what you ask for. The owner sees the list before installing. Known values are `orders:read`, `orders:write`, `customers:read`, `customers:write`, `catalog:read`, `inventory:read`, `payments:read`, `documents:read`, `reports:read`, `events:emit`, `db:own_tables`, `network`, `storefront:scripts`, `admin:ui` and `integrations`.
- `settings`: the form in Admin → Plugins. Types are `text`, `secret`, `boolean`, `select` and `number`. Keys are lowercase letters, digits and underscores.

A `secret` setting is stored encrypted and masked in the admin. `default` (plugin API 1.8) is what the form shows before the shop saves a value. The shop's saved settings do not include it, so apply the same default in your code:

```ts
const config = (await ctx.scope?.config()) ?? {};
const hours = typeof config.notice_hours === 'number' ? config.notice_hours : 24;
```

For installation-wide defaults, read the environment in `setup` with `api.env(name)` and pass them to `api.setDefaultConfig({ … })`. A shop's own settings win over them.

## Providers

`setup(api)` registers what your plugin provides. Each provider has an `id` and `isConfigured(ctx)`. `ctx` is a `ProviderContext` with `tenantId`, the shop's decrypted `config` and a `logger`.

| Call | Interface | Used for |
| --- | --- | --- |
| `registerPaymentProvider` | `PaymentProvider` | Card payments, deposits held on cards, refunds, provider webhooks |
| `registerNotificationChannel` | `NotificationChannel` | Email, `sms` or `whatsapp` messages and delivery reports |
| `registerStorageProvider` | `StorageProvider` | Files (PDFs, uploads) outside the database |
| `registerTaxProvider` | `TaxProvider` | Tax rates per line; tax number checks (1.8) |
| `registerIdentityProvider` | `IdentityProvider` | ID checks before pickup |
| `registerSearchProvider` | `SearchProvider` | Storefront product search |
| `registerRatesProvider` | `RatesProvider` | Exchange rates for prices in other currencies (1.7) |
| `registerGeocoder` | `Geocoder` | Addresses on the map and road distances (1.7) |
| `registerSignatureProvider` | `SignatureProvider` | Electronic signatures on documents |
| `registerIntegration` | `IntegrationProvider` | Connections to accounting, calendar, CRM and other systems (1.2) |

The ECB exchange rate plugin (`packages/plugins/rates-ecb`) is a small complete example:

```ts
import { definePlugin, type RatesProvider } from '@openrent/plugin-sdk';

// ECB, str, parseEcb and crossRates are defined in the same file.
export function ecbRates(): RatesProvider {
  return {
    id: 'ecb',
    isConfigured: () => true,
    async rates(ctx, base, currencies) {
      const res = await fetch(str(ctx.config.url) ?? ECB, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
      const { date, eur } = parseEcb(await res.text());
      return { date, rates: crossRates(eur, base, currencies) };
    },
  };
}

export default definePlugin({
  id: 'rates-ecb', name: 'ECB exchange rates', version: '0.1.0', compat: '^1.7.0', permissions: ['network'],
  settings: [{ key: 'url', label: 'Rates URL (testing only)', type: 'text' }],
  setup(api) {
    api.registerRatesProvider(ecbRates());
  },
});
```

A notification channel throws `DeliveryError(code, message, { permanent })` so OpenRent can explain the failure; permanent failures are not retried. An integration throws `RetryLater(message, ms)` when the other system asks it to wait.

## Hooks

Hooks run inside a core operation. `api.before(name, handler)` runs before it, `api.after(name, handler)` after it. Each handler gets `(payload, ctx)`.

| Hook | Phase core runs | Payload |
| --- | --- | --- |
| `orders.create` | before | The order input |
| `orders.transition` | before, after | `{ order_id, from, action, body }`; after also has `to` |
| `availability.check` | before | `{ order_id, requests }` |
| `pricing.quote` | after | The price breakdown |
| `documents.render` | before | `{ type, order_id, data }` |
| `payments.record` | before, after | Before: a staff payment; after: the payment as the API shows it |
| `checkout.complete` | before | `{ session_id, customer, extra }` |

To refuse an operation, throw `HookVeto` from a `before` hook. The API answers `422` with your code and message:

```ts
api.before('checkout.complete', async (payload: { extra: Record<string, unknown> }, ctx) => {
  const config = (await ctx.scope?.config()) ?? {};
  const closed = String(config.closed_sites ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (closed.includes(String(payload.extra['site-access.site'] ?? ''))) throw new HookVeto('site_closed', 'That site is closed for deliveries.');
});
```

Any other error is logged and ignored: the core operation goes on. A hook has 5 seconds.

## Events

`api.on(type, handler)` runs after an event is committed. `type` is an event type such as `order.created`, or `*` for every event. The handler gets the `DomainEvent` (the same envelope webhooks send) and a context. The Slack plugin (`packages/plugins/notify-slack`) works this way:

```ts
const allowAny = api.env('SLACK_ALLOW_ANY_WEBHOOK') === '1';
api.on('staff_notice.created', async (event: DomainEvent, ctx: HookContext) => {
  const n = event.data.object as StaffNotice;
  const config = (await ctx.scope?.config()) ?? {};
  const url = webhookUrl(config, allowAny);
  if (!url || !wanted(config, n.kind)) return;
  await postNotice(url, n);
});
```

Emit your own events with `ctx.scope!.events.emit('plugin.site-access.code_sent', { order_id })`. Names must start with `plugin.<your id>.`. They reach webhooks and other plugins like core events.

## Schedules

```ts
api.schedule('tidy', '0 3 * * *', async (ctx) => {
  await ctx.scope!.db.query(`DELETE FROM plg_site_access_codes WHERE created_at < now() - interval '1 year'`);
});
```

The cron expression has five fields, in UTC. The job runs once for every shop that has the plugin on, with a one-minute limit. List the job in the manifest's `jobs` too, so the plugins page shows it.

## Routes

```ts
api.route({
  method: 'GET',
  path: '/codes/:order_id',
  permission: 'orders:read',
  async handler(req, ctx) {
    const r = await ctx.scope!.db.query('SELECT code FROM plg_site_access_codes WHERE order_id = $1', [req.params.order_id]);
    return { object: 'site_access_code', code: r.rows[0]?.code ?? null };
  },
});
```

The route answers at `/api/v1/plugins/site-access/codes/{order_id}`. It takes a staff session or a secret key, never a publishable key, and checks `permission` first. A shop that turned the plugin off gets `404`. `req` has `tenantId`, `actor`, `params`, `query` and `body`.

## The plugin scope

Hooks, events, schedules and routes get `ctx.scope`, built for your plugin alone:

- `db.query(sql, values)`: the shop's data under row-level security, inside the caller's transaction. Reads may touch any table. `INSERT`, `UPDATE` and `DELETE` work only on your own `plg_<id>_` tables (dashes become underscores: `plg_site_access_`). One statement per query. Schema changes, `SET`, transaction control and session functions are refused. A failing query never aborts the core operation.
- `services.getOrder(id)`, `getCustomer(id)` and `getProduct(id)`: records in the shape the REST API returns.
- `config()` and `secrets.get(key)`: your settings for this shop, secrets decrypted.
- `events.emit(type, object)`: see [Events](#events).

### Your own tables

Migrations run once per installation, in name order, after OpenRent's own. In an installed plugin, `"migrations": "migrations"` in the manifest names a folder of `.sql` files. In code, pass `migrations: [{ name: '0001_init', sql }]`.

```sql
CREATE TABLE plg_site_access_codes (
  tenant_id text NOT NULL,
  order_id text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id)
);
CREATE INDEX plg_site_access_codes_created ON plg_site_access_codes (created_at);
```

Only `CREATE`, `ALTER` and `DROP TABLE`, `CREATE INDEX`, `INSERT` and `COMMENT` on your own names are accepted. Every table needs `tenant_id text NOT NULL`, and then gets row-level security like core tables. Functions, triggers, policies, grants and `DO` blocks are refused. Never edit an applied migration: OpenRent reports the change and does not run it again. Add a new file.

## Admin extensions

Admin extensions are custom elements. Declare them in the manifest:

```json
"admin": [{ "slot": "order.sidebar", "file": "admin/order-sidebar.js", "element": "site-access-order-sidebar" }]
```

Slots are `order.sidebar`, `order.actions`, `product.tab`, `customer.tab`, `dashboard.widget`, `settings.page`, `nav.item` and `scan.mode`. The element name must start with `<id>-`; the default is `<id>-<slot>`, for example `site-access-order-sidebar`. The admin loads the file from `/api/v1/plugins/{id}/ui/{file}`, places the element and sets its `context` property (`{ order_id }` in the order sidebar). For a bundle hosted elsewhere, call `api.adminSlot(slot, bundleUrl, element)`.

## Storefront extensions

Storefront extensions are data. The storefront renders them, so themes need no code. Register them with `api.storefront({ … })`:

```ts
api.storefront({
  checkoutFields: [
    { key: 'site', type: 'text', required: true, label: { en: 'Site code', de: 'Standortcode' }, help: { en: 'On your site pass' } },
  ],
  productBadges: [{ tag: 'site-delivery', label: { en: 'Delivered on site' }, tone: 'success' }],
  scripts: [
    { src: 'https://cdn.example.com/track.js?site={site_id}', consent: 'analytics', requires: 'site_id', attrs: { 'data-site': '{site_id}' }, connect: ['https://cdn.example.com'] },
  ],
  sections: [
    {
      type: 'opening-banner',
      name: { en: 'Site opening hours' },
      settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'When you can collect' }],
      render: (ctx, settings) => `<h2>${String(settings.heading)}</h2>`,
    },
  ],
});
```

- Checkout fields arrive in the checkout's `extra` as `<plugin id>.<key>` (`site-access.site`) and are stored on the order as the custom field `plg_<id>_<key>`. Types are `text`, `checkbox` and `select`.
- Badges show on products that carry `tag`.
- Scripts load only after the visitor allows their consent category: `necessary`, `analytics` or `marketing`. In `src`, `attrs` and `connect`, `{setting}` is replaced by that plugin setting (1.7). A script whose `requires` setting is empty is left out, as is one that does not end up as an `https` URL. `connect` origins are added to the page's Content-Security-Policy.
- Sections (1.7) are home page section types. Themes that declare the `section.register` extension point offer them as `plugin:<id>:<type>`. `render` returns HTML, which is cleaned like the shop's own HTML. It has 2 seconds; a section that fails renders nothing.

Texts are `LocalizedText`, for example `{ en: '…', de: '…' }`; English is the fallback.

## Testing

`@openrent/plugin-testing` starts a throwaway shop: an in-memory PostgreSQL, the real API with your plugin registered and migrated, and a signed-in owner.

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startTestShop, type TestShop } from '@openrent/plugin-testing';
import plugin from '../src/index.ts';

let shop: TestShop;
beforeAll(async () => {
  shop = await startTestShop({ plugins: [plugin], currency: 'EUR' });
}, 120_000);
afterAll(() => shop?.close());

it('answers on its route', async () => {
  const r = await shop.get('/api/v1/plugins/site-access/codes/ord_1');
  expect(r.status).toBe(200);
  await shop.runSchedule('site-access', 'tidy');
  const rows = await shop.inShop((ctx) => ctx.db.query('SELECT count(*)::int AS n FROM plg_site_access_codes'));
  expect(rows.rows[0].n).toBe(0);
});
```

`TestShop` has `tenantId`, `locationId`, `get`, `post`, `patch`, `request`, `runSchedule(pluginId, name)`, `inShop(fn)` and `close`. The test shop reads `migrations` from the definition, not from a folder: the scaffolded test shows how to pass the SQL file in. Test pure functions (message formatting, parsing) without a shop, as the Slack plugin does.

## Packaging and installing

```sh
openrent plugin check        # manifest, entry file, admin bundles and migrations
openrent plugin pack         # writes site-access-0.1.0.zip
```

The ZIP holds `openrent.plugin.json`, `package.json` (with `"type": "module"` and `main`, default `index.js`) and the built code. Build TypeScript to JavaScript first.

An operator installs a plugin in one of two ways:

- Put the folder in `PLUGINS_DIR` (default `/plugins`) and add its name to `plugins.json` (or the file `PLUGINS_CONFIG` names). An entry is a name or `{ "package": "site-access", "enabled": false }`.
- Upload the ZIP in Admin → Plugins → Install plugin. This works only when the operator sets `OPENRENT_ALLOW_PLUGIN_UPLOAD=true`, never in multi-tenant mode, and only for the shop owner. The ZIP may be up to 20 MB. The owner sees the permissions and manifest warnings, then confirms.

Either way, the plugin loads at the next restart. Each shop then turns it on or off. `openrent plugin disable <id>` turns a broken plugin off for every shop without starting the API.

## Plugin API versions

The running OpenRent provides plugin API `1.8.0` (`PLUGIN_API_VERSION`). `compat` is a semver range checked against it; a plugin outside the range is marked incompatible and not loaded. Minor versions only add things, so `^1.7.0` loads on 1.8. Ask for the lowest version that has what you use:

| Version | Added |
| --- | --- |
| 1.1 | Tax, identity, search and signature providers; the plugin scope; manifests and migrations |
| 1.2 | Integrations |
| 1.3 | `{setting}` in OAuth URLs; `order` and `contact` integration data |
| 1.4 | Accounting entries, lookups and account mapping |
| 1.5 | Payment pages (`redirectUrl`, `returnUrl`); document PDFs for integrations |
| 1.6 | `sms` and `whatsapp` channels; delivery reports |
| 1.7 | Rates providers, geocoders, script placeholders, storefront sections |
| 1.8 | Setting `default`; tax number checks; several tax providers |
