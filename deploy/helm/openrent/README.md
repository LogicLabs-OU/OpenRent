# OpenRent Helm chart

Runs the API, the worker, the storefront and Caddy on Kubernetes. PostgreSQL 16 and S3-compatible storage are yours (a managed database and bucket); the chart does not run them.

```sh
helm install rent deploy/helm/openrent \
  --set publicUrl=https://rent.example.com \
  --set database.url=postgres://openrent_app:…@db.example.com:5432/openrent \
  --set database.migrationUrl=postgres://openrent:…@db.example.com:5432/openrent \
  --set s3.bucket=openrent --set s3.accessKey=… --set s3.secretKey=…
```

Then point the DNS name at the Caddy service (`kubectl get svc rent-openrent-caddy`) and open `/admin/setup`.

## What it does

- **Migrations:** a Job runs `node dist/migrate.js` before every install and upgrade; the API and worker start with `AUTO_MIGRATE=false`. A failed migration stops the upgrade before any new pod starts.
- **Secrets:** the encryption key and session secret are generated once and kept on upgrades and uninstalls (`helm.sh/resource-policy: keep`). Keep a copy of the encryption key: stored plugin secrets cannot be read without it. Or bring your own Secret with `secrets.existingSecret`.
- **Caddy:** TLS with automatic certificates, also for shops' own domains (multi-shop installs). Its certificates live on a small volume. With `ingress.enabled=true` and `caddy.enabled=false`, your cluster's ingress controller does routing and TLS instead.
- **Health:** the API has readiness and liveness probes on `/api/v1/system/health`; `helm test rent` checks the API and the storefront.

See `values.yaml` for every setting. CI lints the chart, installs it in kind, runs `helm test` and upgrades it.
