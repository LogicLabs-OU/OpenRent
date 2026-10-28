# Running an OpenRent server

This page is for the people who install and run OpenRent. It covers installing, configuration, the database, backups, upgrades, scaling, monitoring and security settings. If you host many shops on one installation, also read [running-many-shops.md](running-many-shops.md). The trust boundaries are described in [the threat model](../security/threat-model.md).

## The parts

| Part | Image target | Port | What it does |
|---|---|---|---|
| API | `api` | 7070 | The REST API. It also serves the back office (`/admin`), the API reference (`/docs`), the webhooks from providers (`/webhooks`) and the embeddable widget (`/widget`). It renders document PDFs with headless Chromium. |
| Worker | `worker` | none | Publishes the outbox, delivers webhooks, sends email and texts, runs exports and imports, and runs the scheduled jobs (reminders, recurring billing, accounting, the nightly consistency check and more). Its image also holds the `openrent` command and the PostgreSQL 16 client tools. |
| Storefront | `storefront` | 7072 | The hosted shop. It calls the API server side at `OPENRENT_API_URL`. |
| Caddy | `caddy:2` | 80, 443 | TLS with automatic certificates. It sends `/api/*`, `/admin*`, `/docs*`, `/webhooks/*` and `/widget/*` to the API and everything else to the storefront. Other host names (a shop's own domain) go to the storefront. Caddy asks the API (`/api/v1/system/domain_check`) before it gets a certificate, so only host names that serve a shop get one. |

All three images are built from the `Dockerfile` in the repository root, for example `docker build --target api -t openrent/api .`.

## Install with Docker Compose

The Compose file runs Caddy, the API, the worker, the storefront, PostgreSQL 16 and MinIO for stored files.

1. Create `.env` and fill in the secrets. The script copies `.env.example` to `.env` if there is no `.env` yet:

   ```sh
   ./scripts/gen-secrets.sh
   ```

   It writes `OPENRENT_ENCRYPTION_KEY`, `OPENRENT_SESSION_SECRET` and, once, `MINIO_ROOT_PASSWORD`.

2. Edit `.env`. The values in `.env.example` are for development, so change at least these:

   | Variable | Set it to |
   |---|---|
   | `OPENRENT_DOMAIN` | Your host name, for example `rent.example.com`. Caddy gets the certificate for it. It is not in `.env.example`; add it. |
   | `OPENRENT_PUBLIC_URL` | `https://rent.example.com`. The example value `http://localhost:7070` is wrong behind Caddy. |
   | `STOREFRONT_URL` | `https://rent.example.com`, or the storefront's own address. |
   | `POSTGRES_PASSWORD` | A password of your own. Without it, Compose uses `openrent`. The `postgres` image only reads it when it creates the data volume. |

   Compose builds `DATABASE_URL` from `POSTGRES_PASSWORD` and `ADMIN_URL` from `OPENRENT_PUBLIC_URL`, so the values of those two in `.env` are not used. Leave the `S3_*` lines commented out to use the bundled MinIO.

3. Start everything from the repository root:

   ```sh
   docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d
   ```

4. Open `https://rent.example.com/admin/setup` and create the first shop and its owner.

**`gen-secrets.sh` fills each secret once.** Running it again keeps `OPENRENT_ENCRYPTION_KEY`, `OPENRENT_SESSION_SECRET` and `MINIO_ROOT_PASSWORD` when they are set, and only fills empty ones. A new encryption key would make every stored provider credential unreadable, so keep a copy of `.env` somewhere safe. The script does not set `POSTGRES_PASSWORD` (Compose falls back to `openrent`); set it yourself before the first start, as PostgreSQL keeps the password it was created with.

For a development mail catcher, start `mailpit` with `--profile dev` (UI on port 8025, `SMTP_URL=smtp://localhost:1025`).

## Install with Helm

The chart in `deploy/helm/openrent` runs the API, the worker, the storefront and Caddy on Kubernetes. PostgreSQL 16 and the S3 bucket are yours; the chart does not run them. Read [its README](../../deploy/helm/openrent/README.md) and `values.yaml`. In short:

- A Job runs `node dist/migrate.js` before every install and upgrade. The API and worker start with `AUTO_MIGRATE=false`.
- The chart generates the encryption key and session secret once and keeps them on upgrades and uninstalls. Keep your own copy of the encryption key. You can also bring your own Secret with `secrets.existingSecret`.
- `database.url` is the app role and `database.migrationUrl` the owner role (see [Database roles](#database-roles)).
- `api.replicas` (default 2), `worker.replicas` (default 1) and `storefront.replicas` (default 2) set the number of pods.
- `extraEnv` adds environment variables to the API, the worker and the migration Job.

## Configuration

The API, the worker, the migration Job and the `openrent` command read the same variables. At start they check them and stop with a list of every missing or malformed value. Outside Docker they also load the nearest `.env` file.

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgres://…`. The role requests run as. PostgreSQL 16 with the `btree_gist` and `pg_trgm` extensions. |
| `OPENRENT_PUBLIC_URL` | The address people open, for example `https://rent.example.com`. |
| `OPENRENT_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts provider credentials and webhook secrets in the database (AES-256-GCM). |
| `OPENRENT_SESSION_SECRET` | At least 32 characters. Signs cookies and theme preview links. |

### Database and start-up

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_MIGRATION_URL` | `DATABASE_URL` | The owner role. Migrations, `openrent backup` and `restore`, and erasing a shop use it. |
| `AUTO_MIGRATE` | `true` | The API runs pending migrations when it starts. The worker never migrates. |
| `DATABASE_POOL_MAX` | `10` | Connections in the API's pool. |
| `PGBOSS_POOL_MAX` | `4` | Connections of the worker's job scheduler (pg-boss). |
| `OPENRENT_MIGRATIONS_DIR` | next to the build | Folder with the migration files. The API image sets it to `/app/dist/migrations`. |

### Addresses and mode

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_URL` | `<public URL>/admin` | Where staff open the back office. |
| `STOREFRONT_URL` | the public URL | Used in emails and order QR codes. |
| `OPENRENT_MODE` | `single_tenant` | `multi_tenant` for many shops; see [running-many-shops.md](running-many-shops.md). |
| `OPENRENT_STOREFRONT_DOMAIN` | none | Wildcard host for shops in multi-shop mode, for example `rent.example.com`. |
| `PORT`, `HOST` | `7070`, `0.0.0.0` | Where the API listens. |
| `LOG_LEVEL` | `info` | `debug` shows more. |
| `CORS_ORIGINS` | none | Comma-separated origins that get their own origin back in CORS answers. Other origins get `*`. |

### Storefront

| Variable | Notes |
|---|---|
| `OPENRENT_API_URL` | Base URL of the API, seen from the storefront server. Compose uses `http://api:7070`. |
| `TENANT_SLUG` | Single-shop installs: the shop to serve. Empty serves the only shop. |
| `OPENRENT_STOREFRONT_DOMAIN` | As above. |
| `OPENRENT_PUBLISHABLE_KEY` | Optional `pk_` key. Without it, the shop's slug identifies the shop. |

### Files, email, payments

| Variable | Notes |
|---|---|
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | Object storage for uploads, photos, document PDFs and exports. Leave `S3_ENDPOINT` empty for AWS S3. Without S3 settings, files are kept in PostgreSQL. |
| `SMTP_URL`, `EMAIL_FROM` | The server's default email. A shop's own SMTP settings take priority. Without either, messages stay queued. |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Server-wide Stripe defaults. Shops can set their own keys. |
| `PDF_RENDERER` | `playwright` (default) or `none`. With `none`, documents can still be printed from HTML. |

### Plugins and themes

| Variable | Default | Notes |
|---|---|---|
| `PLUGINS_CONFIG` | none (`/app/plugins.json` in the images) | The list of installed plugins. |
| `PLUGINS_DIR` | `/plugins` | Folder for plugins installed from a ZIP. |
| `OPENRENT_DISABLED_PLUGINS` | none | Comma-separated plugin ids that are not loaded. |
| `OPENRENT_ALLOW_PLUGIN_UPLOAD` | `false` | Lets owners install plugins from a ZIP or URL. Always off in `multi_tenant` mode. An installed plugin loads at the next restart. |
| `THEMES_CONFIG`, `THEMES_DIR` | none | Installed storefront themes, and the folder for themes put there with `openrent theme install`. |

Security variables are listed under [Security settings](#security-settings). Multi-shop variables (`OPENRENT_OPERATOR_KEY`, `OPENRENT_SIGNUP`, `OPENRENT_DEFAULT_LIMITS`) are in [running-many-shops.md](running-many-shops.md).

## Database roles

OpenRent uses two kinds of database role.

- **The owner role** (`DATABASE_MIGRATION_URL`, or `DATABASE_URL` when that is not set) runs the migrations and owns the tables.
- **The app role** (`DATABASE_URL`) runs every request. Each transaction switches to the role `openrent_app` with `SET LOCAL ROLE` and names its shop. `openrent_app` has `NOBYPASSRLS`, so row-level security applies even when `DATABASE_URL` is a superuser.

The first migration creates `openrent_app` (without login) and grants it to the owner role, when the owner role is allowed to. After every migrate run, `packages/db/sql/invariants.sql` is applied again. It turns on and forces row-level security on every table with a `tenant_id` column, grants `openrent_app` read and write access to all tables (but no `UPDATE` or `DELETE` on `audit_log`), and adds triggers that keep inspections, signatures, accounting entries and issued documents from being changed.

To use a separate login for the app, create it before the first migration, then run the migrations as the owner:

```sql
CREATE ROLE openrent_app LOGIN PASSWORD '…' NOBYPASSRLS;
-- or, for a login with another name:
GRANT openrent_app TO my_app_login;
```

At start the API checks the app role. If the role cannot switch to `openrent_app` and bypasses row-level security (a superuser or `BYPASSRLS`), the log says: `DATABASE_URL role bypasses row-level security and cannot switch to openrent_app; tenant isolation relies on application code only`. Fix the grants when you see it.

`invariants.sql` also creates the role `openrent_maintenance` and grants it to the owner role. Only this role may remove rows from the append-only tables, and only while a shop is being erased through the operator API. If the owner role lacks the right, the migration prints a notice and erasing fails. Then grant it yourself as a superuser: `GRANT openrent_maintenance TO <owner role>;`.

### Data access for BI tools

Shops can make database logins for BI tools in **Settings → Data access** (see [Reports](reports.md#read-your-data-in-a-bi-tool)). Each login is a PostgreSQL role that is a member of `openrent_bi`. It may read the views in the schema `bi`, which show its own shop's rows only, and nothing else: no tables, no writing.

For this to work:

- **The owner role** (`DATABASE_MIGRATION_URL`) needs `CREATEROLE`. The migrations then create the roles `openrent_bi` and `openrent_bi_reader` (without login) and the views, and the API makes and removes the shops' logins with that role. Without `CREATEROLE`, the views are left out and the page says why.
- **BI tools must reach the database.** Only open it to the networks that need it, and require TLS. In `pg_hba.conf`, allow the logins with `scram-sha-256` from those networks, for example `hostssl all +openrent_bi 203.0.113.0/24 scram-sha-256`.

Logins are made with a connection limit of 5, a statement timeout of two minutes and read-only transactions. Passwords reach the database only as SCRAM-SHA-256 verifiers, so they never show in its logs. Erasing a shop also removes its logins.

| Variable | Default | Notes |
|---|---|---|
| `OPENRENT_BI_ACCESS` | `on` | `off` stops shops from making or rotating logins. Logins already made can still be revoked. |
| `OPENRENT_BI_HOST` | the host in `DATABASE_URL` | The host BI tools connect to, when it differs, such as a public name or a read replica. |
| `OPENRENT_BI_PORT` | the port in `DATABASE_URL` | |
| `OPENRENT_BI_DATABASE` | the database in `DATABASE_URL` | |
| `OPENRENT_BI_SSLMODE` | `require` | What the page tells BI tools to use. |

With a read replica, logins and views are copied to it from the primary, so point `OPENRENT_BI_HOST` at the replica and keep reports off the primary.

## Migrations

Migrations are SQL files in `packages/db/migrations`, applied in name order. Each one runs in its own transaction and is recorded in `schema_migrations`. A PostgreSQL advisory lock keeps two runs from migrating at the same time. Plugins' own migrations run after OpenRent's.

| Command | Where | What it runs |
|---|---|---|
| `pnpm db:migrate` (`--dry-run` lists pending ones) | a checkout | OpenRent's migrations only. |
| `pnpm openrent migrate [--dry-run]` | a checkout | OpenRent's and the plugins' migrations. |
| `node dist/migrate.js` | the API image | OpenRent's and the plugins' migrations, then exits. The Helm Job runs this. |
| `AUTO_MIGRATE=true` | the API at start | The same, before it listens. This is the Compose default. |

With Compose you can migrate by hand: `docker compose -f deploy/compose/docker-compose.yml --env-file .env run --rm --no-deps api node dist/migrate.js`.

A failed migration is rolled back and the run stops with `migration <name> failed: …`. A plugin migration that is refused is logged as `plugin migration refused` and the API still starts.

## Backups

The `openrent` command is in the worker image, with `pg_dump` and `pg_restore` for PostgreSQL 16. In Compose, the worker has a `backups` volume at `/backups`.

```sh
docker compose -f deploy/compose/docker-compose.yml --env-file .env exec worker openrent backup --out /backups/2026-10-27 --with-files
```

The output folder must be new or empty. A backup holds:

- `database.dump`: a `pg_dump` of the whole database in custom format, made with the owner role. All shops, settings, encrypted credentials and the files kept in PostgreSQL are in it.
- `manifest.json`: the applied migrations, the dump's size and SHA-256, and every stored file with its shop, kind, name, size, SHA-256, storage and key.
- `files/<id>`, only with `--with-files`: a copy of every file kept in object storage. Each copy is checked against its SHA-256 while the backup runs.

A backup does not hold the encryption key, your `.env`, Caddy's certificates, `PLUGINS_DIR` or `THEMES_DIR`. Without `--with-files` it does not hold the files in object storage either; back up the bucket yourself. Keep the encryption key with the backups, or the restored credentials cannot be read.

Copy the backup off the server, for example with `docker compose … cp worker:/backups/2026-10-27 ./`. On Kubernetes, use `kubectl exec` on the worker pod and `kubectl cp`. Use `--pg-dump PATH` if `pg_dump` is somewhere else.

### Restore

`openrent restore DIR --yes` replaces every shop's data in the database. It:

1. checks `database.dump` against the SHA-256 in the manifest and stops if it differs,
2. loads it with `pg_restore --clean --if-exists --single-transaction` (without owners and grants),
3. runs the migrations that are newer than the backup and re-applies `invariants.sql`, which grants `openrent_app` its access again,
4. checks every file in the manifest: the row must exist with the same size and checksum, and the stored object must exist. A missing object is written back from `files/` when the backup has a copy.

It ends with `Checked N files: N put back, N problems` and exits with 1 when there are problems.

The worker image carries the migrations and `invariants.sql` (`OPENRENT_MIGRATIONS_DIR=/app/migrations`), so all four steps run there. With Compose, restore like this:

```sh
C="docker compose -f deploy/compose/docker-compose.yml --env-file .env"
$C stop api worker storefront
$C run --rm --no-deps worker openrent restore /backups/2026-10-27 --yes
$C up -d
```

`restore DIR --check` does not touch the database. It checks the dump's checksum and every file of the manifest against the current database and storage. From a checkout, `pnpm openrent restore DIR --yes` runs all four steps.

On a new PostgreSQL server, create `openrent_app` (and grant it to the owner role) before you restore, as in [Database roles](#database-roles). The restore does not create it.

### Test a restore

Restore into a scratch database now and then. Create one, for example `CREATE DATABASE openrent_restore_test;` in the Compose PostgreSQL, then run the same commands with `-e DATABASE_URL=postgres://openrent:<password>@postgres:5432/openrent_restore_test` after `run --rm --no-deps`. Look for `0 problems`, then drop the scratch database. The file check reads the same bucket as production, and it writes back objects that are missing there.

## Upgrading

All OpenRent packages share one version (changesets with `fixed` in `.changeset/config.json`). Each package's changelog lists what changed. `packages/db/releases.json` records the last migration of each release. A test upgrades a database with data from the release named in `previous` to the current one, so the step from one release to the next is tested. Upgrades across several releases at once are not covered by that test.

1. **Back up**: `openrent backup --out … --with-files`, and keep the encryption key.
2. **Update the images.** With Compose, check out the new release and run `docker compose … build`, then `up -d`. The API applies the migrations when it starts. With Helm, run `helm upgrade` with the new chart or `--set image.tag=x.y.z`. The migration Job runs first, and a failed migration stops the upgrade before any new pod starts.
3. **Check** `/api/v1/system/ready` and the logs.

**Rolling back.** Migrations are forward-only. `pnpm db:rollback` reverts only the last migration, and only when it has a `.down.sql` file; only the first migration has one. To go back, stop the new version, restore the backup from step 1, and start the previous images.

## Scaling

- **API:** run several instances behind Caddy or your load balancer. Each holds its own pool of `DATABASE_POOL_MAX` connections. Sessions live in the database.
- **Worker:** one is enough for most installations, and you can run more (`worker.replicas`, or `--scale worker=2` with Compose). Outbox rows, webhook deliveries, emails and exports are claimed with `FOR UPDATE SKIP LOCKED`. Each scheduled job runs once per run through pg-boss. At most 4 requests go to one webhook endpoint at a time across all workers.
- **Connections:** each worker uses 5 pool connections, `PGBOSS_POOL_MAX` for pg-boss and 1 for `LISTEN`. Keep the sum over all instances below PostgreSQL's `max_connections`.
- **Files:** without `S3_*`, files are kept in PostgreSQL, which suits small shops and development. For more, use object storage. Move files from PostgreSQL to the bucket with `openrent files migrate-storage [--tenant ID]`, and check them with `openrent files verify`. The worker also checks a sample every week.
- **PDFs:** the API and the worker render PDFs with headless Chromium, one browser per process. The images include it. Outside Docker, install it with `pnpm exec playwright install chromium`, or set `PDF_RENDERER=none`.
- **Rate limits:** `RATE_LIMIT_PER_MINUTE` (default 600) counts per API key, per staff session or per client address, and each API instance counts on its own. With N instances, a client can make up to N times the limit.
- **Uploaded plugins:** they are written to `PLUGINS_DIR` and `PLUGINS_CONFIG` on the instance that received them. With several instances, share that folder.

## Monitoring

| Endpoint | Answer |
|---|---|
| `GET /api/v1/system/health` | `{"status":"ok"}` while the process runs. It does not touch the database. The image's health check and the Helm probes use it. |
| `GET /api/v1/system/ready` | 200 with `database`, `storage`, `migrations_applied`, `outbox_backlog` and each plugin's state. 503 when the database or the configured object storage does not answer. |
| `GET /api/v1/system/version` | The version, the API version and the plugin API version. |
| `GET /api/v1/system/metrics` | Prometheus text: requests, 5xx errors, uptime, heap, pool size and waiting clients. Counters are per instance. |

`/metrics` needs the header `X-Operator-Key: <OPENRENT_OPERATOR_KEY>`. Without `OPENRENT_OPERATOR_KEY` set, it answers 404: set the key to scrape metrics.

**Logs.** The API and the worker write JSON lines to standard output, at `LOG_LEVEL`. Every API answer has an `X-Request-Id` header, and the same id is in the log. Read the logs with `docker compose … logs -f api worker` or `kubectl logs`.

**Outbox backlog.** Events wait in the `outbox` table until the worker publishes them to webhooks, integrations and plugins. `outbox_backlog` in `/ready` is the number not yet published. A number that keeps growing means no worker runs, or publishing fails: look for `outbox publish failed; will retry` in the worker log.

Other worker log lines worth an alert: `stored files are missing from object storage`, `availability shortage: allocations exceed capacity`, `payment reconciliation found differences` and `webhook delivery failed`.

## Security settings

| Variable | Default | Notes |
|---|---|---|
| `TRUST_PROXY` | loopback and private networks | Which proxies may name the client's address in `X-Forwarded-For`. `true` trusts any, `false` none, or give addresses and CIDRs. Rate limits per address depend on it. |
| `OPENRENT_OUTBOUND_ALLOW` | none | Requests to addresses a shop chose (webhooks, imports, images in documents, and in `multi_tenant` mode every outbound request) refuse private and reserved networks. List your own services here, for example `meilisearch:7700`. |
| `WEBHOOKS_ALLOW_PRIVATE_NETWORK` | `false` | `true` lets webhooks reach private addresses. Use it only on a single-shop install you control. |
| `OPENRENT_OPERATOR_KEY` | none | Protects `/metrics` and turns on the operator API. Generate it with `openssl rand -hex 32`. |

**Encryption key.** OpenRent has no key rotation. A secret is encrypted with the one key in `OPENRENT_ENCRYPTION_KEY`, and a different key cannot read it. If the key is lost, every shop must enter its provider credentials again. Webhook endpoint secrets and API keys can be rotated one by one in the back office or the API.

**Content Security Policy.** The back office and the storefront send a Content Security Policy built into their bundles. The back office allows scripts only from its own origin and cannot be framed. The storefront allows framing only by itself and the API's origin (for theme previews), and adds the origins a shop's payment provider needs. The storefront takes the API's origin from `OPENRENT_PUBLIC_URL` (or `OPENRENT_API_URL`) when it is built, so build it with your public address when the API lives on another host.

## Troubleshooting

| What you see | What to do |
|---|---|
| `Invalid configuration:` and a list at start | Set each value in the list. `OPENRENT_ENCRYPTION_KEY` must decode to exactly 32 bytes. |
| `DATABASE_URL role bypasses row-level security …` | Grant `openrent_app` to the app role, or use a role that is a member of it. |
| Every client is rate limited at once | The API sees your proxy's address. Set `TRUST_PROXY` to the proxy's address. |
| `PDF rendering is unavailable on this server` (503) | Install Chromium (`pnpm exec playwright install chromium`) or set `PDF_RENDERER=none`. |
| `/ready` answers 503 with `storage: error` | Check the `S3_*` values and that the bucket exists. |
| Provider credentials stopped working after a change to `.env` | `OPENRENT_ENCRYPTION_KEY` changed, maybe by running `gen-secrets.sh` again. Put the old key back. |
| Stored files cannot be read after changing `MINIO_ROOT_PASSWORD` | Put the old password back. MinIO keeps the one it started with. |
| `pg_dump was not found` | Run the command in the worker container, or pass `--pg-dump PATH` / `--pg-restore PATH`. Use client tools that match the server's PostgreSQL version. |
| `… is not empty. Choose a new folder.` | `backup --out` needs a new or empty folder. |
| `The database dump does not match the manifest` | The backup is damaged. Use another one. |
| `The database user cannot erase shops` | Grant `openrent_maintenance` to the owner role. |
| No certificate for a shop's own domain | Caddy asks `/api/v1/system/domain_check?domain=…`. It answers 404 until the domain is added to a shop. |
| Webhooks and emails are late | Check that the worker runs and look at `outbox_backlog`. |
