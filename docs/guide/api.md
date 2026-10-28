# The REST API

Every OpenRent feature is in the REST API under `/api/v1`. The back office and the storefront call the same endpoints you do. Money is always `{ "amount": 4500, "currency": "EUR" }`, with the amount in minor units. Times are ISO 8601 with an offset.

## The API document

- `GET /api/v1/openapi.json` returns the OpenAPI 3.1 document of the running installation.
- `/docs` shows the same document as an interactive reference.
- The repository keeps a copy in `packages/api-spec/openapi.json`. The SDK types are generated from it.

Each operation lists the permission it needs in `x-permission`, and its `security` says which credentials it takes.

## Authentication

| Credential | How you send it | What it reaches |
| --- | --- | --- |
| Secret key `sk_live_…` or `sk_test_…` | `Authorization: Bearer sk_live_…` | Everything its scopes allow. Servers only. |
| Publishable key `pk_live_…` | `Authorization: Bearer pk_live_…` | Only `/api/v1/storefront/*` and `/api/v1/portal/*`. |
| Session cookie `or_session` | The cookie, plus `X-CSRF-Token` on writes | What the signed-in staff member may do. |
| Shop slug | `X-Tenant-Slug: my-shop` | Only the storefront and portal namespaces. |

### Secret keys and scopes

Create keys in Admin → Settings → API keys, or with `POST /api/v1/api_keys` (permission `api_keys:manage`). The answer shows the key once. Store it then.

```sh
curl https://rent.example.com/api/v1/api_keys \
  -H "Authorization: Bearer $OPENRENT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name": "Warehouse sync", "kind": "secret", "scopes": ["orders:read", "inventory:read", "inventory:write"]}'
```

Scopes are permissions of the form `resource:action`, for example `orders:read`, `orders:write`, `orders:fulfil`, `customers:read`, `catalog:write`, `payments:refund`, `webhooks:manage` or `reports:read`. `*` grants everything, and `orders:*` grants every action on orders. `orders:write` also grants `orders:fulfil`. You cannot give a key more than you have yourself. Without `scopes`, the key gets your own permissions. `POST /api/v1/api_keys/{id}/actions/rotate` replaces a key.

A request without the right permission gets `403 forbidden`. An unknown or revoked key gets `401 invalid_api_key`.

### Publishable keys

A publishable key is safe to put in a web page. It always has the single scope `storefront`, and any call outside the storefront and portal namespaces gets `403 forbidden`. Without a key, name the shop with `X-Tenant-Slug`. The API also finds the shop from a verified custom domain, from a `{slug}.` subdomain of the storefront domain, or, when the installation has one shop, by itself.

### Session cookies

The admin signs in with `POST /api/v1/auth/login`. The answer sets `or_session` and `or_csrf` cookies and returns the same CSRF token as `csrf_token`. Every request other than `GET`, `HEAD` and `OPTIONS` must send that token in `X-CSRF-Token`, or it gets `403 csrf_failed`. A staff member of several shops picks one with `X-Tenant-Id`.

```sh
curl -c jar.txt https://rent.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email": "anna@example.com", "password": "…"}'
# {"object":"session","user_id":"usr_…","tenant_id":"ten_…","csrf_token":"Zx3…"}

curl -b jar.txt -X PATCH https://rent.example.com/api/v1/orders/1042 \
  -H 'X-CSRF-Token: Zx3…' -H 'Content-Type: application/json' -d '{"tags": ["vip"]}'
```

Use secret keys for integrations. Sessions are for the admin.

### OAuth for apps

An app that many shops use, such as a WordPress plugin or a Shopify app, signs in with OAuth 2.1 instead of asking each shop for a secret key. The shop's owner or an admin approves it once, and can disconnect it under **Settings → Apps**.

OpenRent describes itself at `/.well-known/oauth-authorization-server` (RFC 8414). The steps:

1. **Register the app** once per installation. An app registers itself as a public client with `POST /oauth/register` (RFC 7591): `{"client_name": "…", "redirect_uris": ["https://…"]}`. Addresses must be `https`, or `http` on `localhost`. The answer holds the `client_id`. An app that keeps a secret on a server can be registered by the operator instead, with `POST /api/v1/operator/oauth_clients` and the `X-Operator-Key` header; the answer then also holds a `client_secret`, shown once.
2. **Send the person to `/oauth/authorize`** with `response_type=code`, `client_id`, `redirect_uri`, `scope` (scopes like those of secret keys, separated by spaces, such as `catalog:read orders:read`), `state`, and a PKCE `code_challenge` with `code_challenge_method=S256`. PKCE is required. They sign in to the admin if they are not yet, see what the app asks for, and choose **Connect** or **Decline**. The app gets at most the scopes the person has.
3. **Exchange the code** at `POST /oauth/token` (form or JSON) with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri` and `client_id` (a confidential client authenticates with HTTP Basic or `client_secret`). Codes last ten minutes and work once.
4. **Call the API** with `Authorization: Bearer <access_token>`. The token names the shop; it lasts an hour.
5. **Refresh** with `grant_type=refresh_token`. Each refresh token works once and comes back with a new one. If an old refresh token is used again, OpenRent takes it as stolen and ends the app's access to the shop; the person must connect it again. Refresh tokens last 60 days.

`POST /oauth/revoke` (RFC 7009) ends a token; a refresh token ends the app's access. Errors follow OAuth: `{"error": "invalid_grant", "error_description": "…"}`.

## Conventions

### Request ids

Every answer carries `X-Request-Id`. Send your own (8–64 letters, digits, `_` or `-`) to follow a request through your logs. Errors include it as `request_id`.

### Idempotency keys

Send `Idempotency-Key` on any `POST`. A repeated key with the same method, path and body returns the stored answer with `Idempotent-Replayed: true`, and nothing runs twice.

- The same key with a different body gets `422 idempotency_key_reused`.
- A repeat while the first request still runs gets `409 idempotency_in_progress`.
- When the first request fails, the key is released and you may retry with it.

Keys are kept per shop and may be up to 200 characters. The SDK adds one to every `POST` for you.

### ETags and If-Match

Orders carry a `version`. `GET`, `POST` and `PATCH` on orders, and the order actions, answer with `ETag: W/"<version>"`. Send it back in `If-Match` on `PATCH /api/v1/orders/{id}` or `POST /api/v1/orders/{id}/actions/{action}`. When someone changed the order since you read it, you get `412 precondition_failed` with `current_version`. Without `If-Match`, the change applies to whatever is there.

### Errors

Errors are RFC 9457 problem details with `Content-Type: application/problem+json` and a stable `code`. Validation errors list the fields:

```json
{
  "type": "https://openrent.dev/errors/validation_error",
  "title": "Bad request",
  "status": 400,
  "code": "validation_error",
  "detail": "The request is invalid",
  "errors": [{ "field": "body.starts_at", "code": "required", "message": "must have required property 'starts_at'" }],
  "request_id": "req_01J…"
}
```

Branch on `code`, not on `detail`: the detail follows the language of `Accept-Language` (or the staff member's language). A plugin that refuses an operation answers `422` with the plugin's own code. A payment provider failure is `502 provider_error`.

### Lists, filters and search

Lists answer `{ "data": [...], "has_more": true, "next_cursor": "…" }`.

| Parameter | Meaning |
| --- | --- |
| `limit` | 1 to 200, default 50 |
| `cursor` | `next_cursor` of the previous page |
| `sort` | Comma separated fields; `-` in front sorts descending |
| `q` | Full-text search |
| `filter[field]=a,b` | Field equals one of the values |
| `filter[field][gte]=…` | Also `lte`, `gt` and `lt` |

Each list's summary names its filters. For orders they are `status`, `payment_status`, `customer_id`, `location_id`, `source`, `starts_at` and `ends_at`.

```sh
curl -G https://rent.example.com/api/v1/orders \
  -H "Authorization: Bearer $OPENRENT_KEY" \
  --data-urlencode 'filter[status]=reserved,out' \
  --data-urlencode 'filter[starts_at][gte]=2026-11-01T00:00:00+01:00' \
  -d limit=100 -d sort=-starts_at
```

### Expand

`expand` loads related records in the same answer, at most 8 per request. `GET /api/v1/orders/{id}?expand=customer,payments` takes `customer`, `location`, `payments`, `payment_requests`, `deposits`, `documents`, `damage_charges` and `notifications`.

### Rate limits

Each secret or publishable key, each session and, for anonymous calls, each IP address has its own budget: 600 requests a minute unless the operator sets `RATE_LIMIT_PER_MINUTE`. Some routes have lower limits, for example the portal sign-in. Every answer carries `RateLimit-Limit`. Over the limit you get `429 rate_limited` with `Retry-After` in seconds.

## The storefront namespace

`/api/v1/storefront/*` is what a shop visitor may do: settings, the catalogue (`catalog/products`, `catalog/categories`), `availability`, `price_quote`, carts as `checkout_sessions`, `checkout_sessions/{id}/actions/complete`, the order page (`orders/{id}?token=…`) and the customer account. Call it with a publishable key or `X-Tenant-Slug`. It answers any origin and never uses cookies. `Accept-Language` picks the language, and `X-Display-Currency` shows prices in another currency the shop offers.

To build your own shop website on it, read [A headless storefront](headless-storefront.md).

## The portal namespace

`/api/v1/portal/*` is the account area for business customers: their profile, bookings, documents and what they owe. It names the shop like the storefront does, and the customer signs in by email:

1. `POST /api/v1/portal/auth/request_link` with `{ "email": "…" }` answers `202` and emails a sign-in link. The answer is the same whether the email is known or not.
2. `POST /api/v1/portal/auth/verify` with `{ "token": "…" }` from the link returns `{ "object": "account_session", "token": "…", "expires_at": "…" }`.
3. Send that token as `X-Customer-Session` on `GET /api/v1/portal/me`, `GET /api/v1/portal/orders` and the other portal calls.
4. `POST /api/v1/portal/auth/logout` ends the session.

## Webhooks

Webhooks send events to your server as they happen. Manage endpoints in Admin → Settings → Webhooks or with the API (permission `webhooks:manage`):

```sh
curl https://rent.example.com/api/v1/webhook_endpoints \
  -H "Authorization: Bearer $OPENRENT_KEY" -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/openrent", "events": ["order.*", "payment.succeeded"]}'
```

The answer includes `secret` (`whsec_…`) once. `events` takes exact types, `prefix.*` or `*` (the default). Endpoint URLs must use HTTPS and a public host, unless the operator sets `WEBHOOKS_ALLOW_PRIVATE_NETWORK=true`.

Some event types: `order.created`, `order.updated`, `order.status_changed`, `order.overdue`, `payment.succeeded`, `payment.failed`, `payment.refunded`, `deposit.authorized`, `customer.created`, `document.issued`, `document.signed`, `product.updated`, `stock_item.status_changed`, `stock_item.packed`, `stock_item.unpacked`, `document.paid` (a customer invoice without a booking is paid in full) and `webhook_endpoint.disabled`. Plugins add `plugin.<id>.<name>`. `GET /api/v1/webhook_events` lists recent events with their payloads.

Each delivery is a `POST` with this body:

```json
{
  "id": "evt_…", "type": "order.status_changed", "api_version": "2026-10-01",
  "created_at": "2026-11-03T09:12:44.120Z", "tenant_id": "ten_…", "livemode": true,
  "data": { "object": { "id": "ord_…", "object": "order", "status": "out", "from": "reserved", "to": "out" }, "previous_attributes": { "status": "reserved" } },
  "request": { "id": "req_…", "idempotency_key": null },
  "actor": { "type": "user", "id": "usr_…" }
}
```

and these headers: `OpenRent-Event-Id`, `OpenRent-Event-Type`, `OpenRent-Delivery-Id`, `OpenRent-Delivery-Attempt` and `OpenRent-Signature`. A body over 256 KB is cut to the object's id and API URL, with `"truncated": true`.

### Verifying the signature

`OpenRent-Signature` is `t=<unix seconds>,v1=<hex>`: an HMAC-SHA256 of `` `${t}.${rawBody}` `` with the endpoint secret. Verify it on the raw body, before you parse it:

```ts
import { verifyWebhook } from '@openrent/sdk/webhooks';

export async function handle(request: Request): Promise<Response> {
  const raw = await request.text();
  const ok = await verifyWebhook(raw, request.headers.get('OpenRent-Signature') ?? '', process.env.OPENRENT_WEBHOOK_SECRET!);
  if (!ok) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(raw);
  if (await alreadyHandled(event.id)) return new Response('ok');
  await handleEvent(event);
  return new Response('ok');
}
```

`verifyWebhook` refuses timestamps more than 5 minutes off; pass `{ toleranceSec }` to change that. It uses Web Crypto, so it works in Node 18+, browsers and edge runtimes. After `POST /api/v1/webhook_endpoints/{id}/actions/rotate_secret`, deliveries carry a `v1` for the old and the new secret for 24 hours.

### Retries

Answer with a 2xx status within 10 seconds. Anything else, including a redirect, is a failure. OpenRent tries again after 1 minute, 5 minutes, 30 minutes, 2, 6, 12, 24 and 24 hours, each give or take 10 %. When an endpoint has failed for more than three days, it is turned off (`disabled_failures`) and the shop's owners and admins are told.

Delivery is at least once: the same event can arrive twice, so deduplicate on the event `id`. `GET /api/v1/webhook_endpoints/{id}/deliveries` shows attempts and answers, `POST /api/v1/webhook_deliveries/{id}/actions/redeliver` sends one again, and `POST /api/v1/webhook_endpoints/{id}/actions/test` sends a `ping`.

## The typed SDK

`@openrent/sdk` is a client typed from the OpenAPI document, built on `openapi-fetch`.

```ts
import { createClient, OpenRentError } from '@openrent/sdk';

const api = createClient({ baseUrl: 'https://rent.example.com', apiKey: process.env.OPENRENT_KEY });

const { data: order } = await api.GET('/api/v1/orders/{id}', { params: { path: { id: '1042' }, query: { expand: 'customer' } } });

try {
  await api.POST('/api/v1/orders/{id}/actions/check_out', { params: { path: { id: order!.id } }, body: {} });
} catch (err) {
  if (err instanceof OpenRentError && err.code === 'precondition_failed') {
    // reload and try again
  }
}
```

What `createClient` does for you:

- Sends `apiKey` as a bearer token and `tenantSlug` as `X-Tenant-Slug`.
- Adds an `Idempotency-Key` to every `POST` that has none.
- Retries `429`, `502`, `503`, `504` and network errors with backoff, honouring `Retry-After`. It retries only `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE` and keyed requests. `retries` defaults to 2.
- Throws `OpenRentError` for every error answer, with `status`, `code` and the whole `problem`.

The typed query parameters do not list `filter[…]`. Put filters in a variable, which TypeScript accepts:

```ts
const query = { limit: 100, 'filter[status]': 'reserved,out' };
const { data: page } = await api.GET('/api/v1/orders', { params: { query } });
```

For a website, use `createStorefront` from `@openrent/sdk/storefront` with a publishable key. It wraps settings, products, the calendar, quotes, the cart and checkout. See [A headless storefront](headless-storefront.md).
