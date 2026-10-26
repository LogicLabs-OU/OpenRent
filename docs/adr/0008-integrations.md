# ADR 0008: Integrations with other systems

Status: accepted (accounting extended by [ADR 0009](0009-accounting-sync.md))

Shops want their bookings to show up in the software they already run: accounting first (FR-INT-3), calendars next (FR-INT-4), later CRMs and messaging. Webhooks (ADR 0003) already send every event out, but each shop would have to host and maintain the receiver. This record describes one framework, built into core, that plugins plug other systems into.

## A plugin provides the integration, core runs it

- A plugin with the `integrations` permission calls `api.registerIntegration(provider)` (plugin API 1.2). The provider declares:
  - `id`, `name` and a `category` (accounting, calendar, crm, marketing, messaging, other);
  - `auth`: OAuth 2 (authorize and token URLs, scopes, and the names of the plugin settings that hold the app's client ID and secret) or typed `fields` (an API key). Since plugin API 1.3, OAuth also takes:
    - `clientAuth: 'body'` for token endpoints that want the app's credentials in the form body (HubSpot, Zoho);
    - `tokenPrefix` for APIs that want another word than `Bearer` (Zoho: `Zoho-oauthtoken`);
    - `{setting}` placeholders in the URLs for providers with regional hosts (`https://accounts.zoho.{data_center}/…`);
  - `events`: the event types it wants;
  - `settings`: options the shop sets on the connection (account codes, tax codes, calendars);
  - `onConnected(ctx, params)`: checks the credentials and returns the account name and ids to keep;
  - `handle(ctx, task)`: sends one record across and returns `done` or `skipped`, or throws to try again later.
- Core owns everything around that: connecting, token storage and refresh, queueing, retries, the remote-id map, the log and the admin page. A provider stays small; the Xero and QuickBooks plugins are under 200 lines each.

## Connections

- Table `integration_connections`, one live connection per shop and provider (status `pending`, `connected`, `error` or `disconnected`).
- OAuth 2 uses PKCE. The state is stored only as a hash and the verifier is encrypted. The callback (`GET /api/v1/integrations/oauth/callback`) is one URL for every provider and every shop, which is what an app registration with Xero or Intuit needs. The shop is found from the state hash. Extra values the provider sends back (QuickBooks' `realmId`) go to `onConnected`.
- Tokens and typed credentials are encrypted with the instance key. The data export redacts them.
- An access token is refreshed a minute before it expires, and once more on a 401. A refreshed token is saved even when the task that needed it fails, so a rotating refresh token is never lost.
- `sync_from` is set to the moment of connecting: older records go across only when the shop asks for them (catch-up).

## Tasks

- The worker publishes the outbox as before. After the webhooks, each event becomes one row in `integration_tasks` for each connection that wants it. The row is keyed by the event id, so publishing twice queues once.
- Catch-up queues issued invoices and credit notes, payments, refunds and customers since a date, keyed by record, so asking twice queues once.
- The job `integrations.run` runs every minute and works through due tasks, oldest first. Each task runs in its own tenant transaction and savepoint, with a 30-second timeout.
- A task that throws is tried again after 1, 5, 15, 60, 240 and then 720 minutes. After 8 tries it is `failed`, and the connection shows `error` with the message. Staff retry from the log. A task that succeeds sets the connection back to `connected`.
- Disconnecting deletes the credentials and skips waiting tasks. The log and the remote-id map stay.

## Remote ids

- Table `integration_links` maps a local record to its id in the other system, per connection (`ctx.links.get` and `set`).
- A provider checks the map before it creates anything. A customer becomes one contact, and a credit note finds the invoice it corrects.

## Accounting data is neutral

- `ctx.data.accounting` turns an issued invoice or credit note, a payment or a customer into a neutral record. For a document it uses the frozen document data, never the live order, so what reaches the accounting system matches the PDF the customer got. Lines carry a kind (rental, sale, service, fee, damage, late fee, discount, other), net amounts, the tax rate and amount. A payment carries its purpose, so deposits are told apart from charges.
- Providers map kinds to their own account codes and tax codes through connection settings.
- Other categories read neutral records too (plugin API 1.3): `ctx.data.contact(customerId)` and `ctx.data.order(orderId)` (number, status, source, dates, totals, location, lines, contact). Catch-up also covers `order.created` and returned bookings (`order.checked_in`).
- Shops without a connected system download a double-entry journal (CSV or XLSX, `GET /accounting/journal`) built from the same records. Its account codes are set per shop (`settings.accounting.accounts`). Every booking is balanced.

## Consequences

- A new system needs only a plugin. Calendar push (G3) reuses connections, tasks, links and the log.
- Records reach the other system up to a minute after the event, not inside the request. Staff see delays and failures in the sync log instead of in the order.
- Deposits and their refunds are not sent to Xero or QuickBooks: they are liabilities, not sales. The journal books them to the deposits account.
- A provider can only see what the context gives it. It has no direct database access.
