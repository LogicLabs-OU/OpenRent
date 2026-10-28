import { createServer } from 'node:http';
import { createApp, fileStore } from './app.ts';

/**
 * Runs the app: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (from the app in the Shopify Partner Dashboard),
 * `APP_URL` (where this answers, https), and optionally `PORT`, `DATA_DIR` and `SHOPIFY_API_VERSION`.
 */
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const app = createApp({
  apiKey: need('SHOPIFY_API_KEY'),
  apiSecret: need('SHOPIFY_API_SECRET'),
  appUrl: need('APP_URL').replace(/\/$/, ''),
  apiVersion: process.env.SHOPIFY_API_VERSION ?? '2026-10',
  scopes: process.env.SHOPIFY_SCOPES ?? '',
  base: (shop) => `https://${shop}`,
  store: fileStore(process.env.DATA_DIR ?? './data'),
});
const port = Number(process.env.PORT ?? 3457);
createServer((req, res) => void app(req, res)).listen(port, () => process.stdout.write(`OpenRent for Shopify on :${port}\n`));
