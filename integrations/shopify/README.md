# OpenRent for Shopify

The Shopify app: theme app blocks that show OpenRent's booking widget (`extensions/openrent-blocks`), and the small server that installs the app in a shop and connects the shop to OpenRent (`server`).

See [docs/guide/wordpress-and-shopify.md](../../docs/guide/wordpress-and-shopify.md#shopify) for setting it up.

- `node server/main.ts` runs the server; it needs `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `APP_URL`, and takes `PORT` (3457), `DATA_DIR` (`./data`), `SHOPIFY_API_VERSION` (`2026-10`) and `SHOPIFY_SCOPES` (none).
- `pnpm test` runs the server against stand-ins for Shopify and OpenRent, and renders the blocks with LiquidJS. The end-to-end test `e2e/shopify.spec.ts` runs it against a real OpenRent.
- A real development store is not part of the tests: check an install there before a release.
