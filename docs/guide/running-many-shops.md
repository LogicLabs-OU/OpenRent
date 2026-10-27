# Running many shops (managed hosting)

One OpenRent installation can host many rental shops. This page is for the people who run such an installation.

## Turn it on

In the environment of the API and worker:

| Setting | What it does |
|---|---|
| `OPENRENT_MODE=multi_tenant` | Shops are found by `{slug}.OPENRENT_STOREFRONT_DOMAIN` and by their own domains. |
| `OPENRENT_OPERATOR_KEY` | Turns on the operator API (below) and protects `/api/v1/system/metrics`. Send it as `X-Operator-Key`. |
| `OPENRENT_SIGNUP=1` | Anyone may open a shop at `/admin/signup`. A link appears on the sign-in page. |
| `OPENRENT_DEFAULT_LIMITS` | Limits for shops opened by sign-up, as JSON: `{"orders_per_month":100,"storage_mb":1024,"plugins":5}`. |
| `OPENRENT_OUTBOUND_ALLOW` | Your own internal services that plugins may call (e.g. `meilisearch:7700`). Everything else on private networks is refused for every outbound request. |

Run first-run setup once (`/admin/setup`) for your own shop; sign-up is for every shop after it. An email that already has an account must give that account's password, so nobody can open a shop in someone else's name.

## Limits

| Limit | Counts |
|---|---|
| `orders_per_month` | Orders created in the shop's calendar month (its time zone), online and by staff. |
| `storage_mb` | Every stored file: photos, documents, uploads. |
| `plugins` | Plugins the shop has turned on or set up itself. |

A shop at a limit gets a clear message (HTTP 402) when it tries to go over it; nothing it already has is touched. Shops see their usage under **Settings → General → Plan and usage**. A limit of `null` means none.

## The operator API

Every call needs `X-Operator-Key: $OPENRENT_OPERATOR_KEY`.

```sh
# Every shop with its status, limits and this month's usage
curl -H "X-Operator-Key: $KEY" https://rent.example.com/api/v1/operator/shops

# Change a shop's limits (null removes one)
curl -X PATCH -H "X-Operator-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"limits":{"orders_per_month":500}}' https://rent.example.com/api/v1/operator/shops/ten_…

# Suspend and resume
curl -X POST -H "X-Operator-Key: $KEY" -H 'Content-Type: application/json' -d '{"reason":"Unpaid invoice"}' \
  https://rent.example.com/api/v1/operator/shops/ten_…/actions/suspend
curl -X POST -H "X-Operator-Key: $KEY" https://rent.example.com/api/v1/operator/shops/ten_…/actions/resume

# Erase a suspended shop for good; confirm with its slug
curl -X DELETE -H "X-Operator-Key: $KEY" 'https://rent.example.com/api/v1/operator/shops/ten_…?confirm=kais-kayaks'
```

**Suspending** keeps every record. The shop's staff see a page that says it is suspended, with your reason; its storefront says the shop is not available; the worker pauses its reminders, emails and plugin jobs. Resuming picks everything up again, and messages that waited are sent then.

**Erasing** removes the shop's stored files, then every row it has, in one database transaction, including the records that can otherwise never be changed (audit log, accounting entries, issued documents, inspections, signatures). Staff accounts that belonged to no other shop go too. It cannot be undone: export the shop's data first if it asked for a copy (**Settings → Data export**).

Erasing runs as the `openrent_maintenance` database role. `pnpm db:migrate` creates it and grants it to the user that runs migrations (`DATABASE_MIGRATION_URL`). On a managed database where that user may not create roles, create it once yourself:

```sql
CREATE ROLE openrent_maintenance NOLOGIN;
GRANT openrent_maintenance TO openrent;  -- the migration user
```

## A status page

Customers and shops want to know when something is wrong. OpenRent does not host a status page itself; point one at these:

| Check | URL | Healthy |
|---|---|---|
| API alive | `GET /api/v1/system/health` | 200 `{"status":"ok"}` |
| API ready | `GET /api/v1/system/ready` | 200 with `database: ok` and storage; 503 when not |
| Storefront | `GET /` on a shop's address | 200 |
| Metrics | `GET /api/v1/system/metrics` with `X-Operator-Key` | Prometheus text; watch `openrent_http_errors_total`, `openrent_db_pool_waiting` |

Any uptime service works (Uptime Kuma, Better Stack, a Prometheus blackbox exporter). Check every minute, alert after two failures in a row, and show the API and storefront as separate components so a storefront problem does not look like a full outage. The `outbox_backlog` in `/system/ready` tells you whether the worker keeps up: a number that keeps growing means emails and webhooks are late.
