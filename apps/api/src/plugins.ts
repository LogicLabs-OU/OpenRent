import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost, loadPlugins } from '@openrent/plugin-host';
import type { Logger } from '@openrent/plugin-sdk';

/** First-party plugins resolve statically so bundlers include them. */
const BUILTIN = {
  '@openrent/plugin-payment-stripe': () => import('@openrent/plugin-payment-stripe'),
  '@openrent/plugin-payment-mollie': () => import('@openrent/plugin-payment-mollie'),
  '@openrent/plugin-payment-paypal': () => import('@openrent/plugin-payment-paypal'),
  '@openrent/plugin-notify-smtp': () => import('@openrent/plugin-notify-smtp'),
  '@openrent/plugin-notify-postmark': () => import('@openrent/plugin-notify-postmark'),
  '@openrent/plugin-notify-resend': () => import('@openrent/plugin-notify-resend'),
  '@openrent/plugin-notify-twilio': () => import('@openrent/plugin-notify-twilio'),
  '@openrent/plugin-notify-messagebird': () => import('@openrent/plugin-notify-messagebird'),
  '@openrent/plugin-storage-s3': () => import('@openrent/plugin-storage-s3'),
  '@openrent/plugin-accounting-xero': () => import('@openrent/plugin-accounting-xero'),
  '@openrent/plugin-accounting-quickbooks': () => import('@openrent/plugin-accounting-quickbooks'),
  '@openrent/plugin-accounting-zoho-books': () => import('@openrent/plugin-accounting-zoho-books'),
  '@openrent/plugin-crm-hubspot': () => import('@openrent/plugin-crm-hubspot'),
  '@openrent/plugin-calendar-google': () => import('@openrent/plugin-calendar-google'),
  '@openrent/plugin-calendar-microsoft': () => import('@openrent/plugin-calendar-microsoft'),
  '@openrent/plugin-reviews-trustpilot': () => import('@openrent/plugin-reviews-trustpilot'),
  '@openrent/plugin-tax-taxjar': () => import('@openrent/plugin-tax-taxjar'),
  '@openrent/plugin-tax-vies': () => import('@openrent/plugin-tax-vies'),
  '@openrent/plugin-notify-slack': () => import('@openrent/plugin-notify-slack'),
  '@openrent/plugin-rates-ecb': () => import('@openrent/plugin-rates-ecb'),
  '@openrent/plugin-analytics': () => import('@openrent/plugin-analytics'),
  '@openrent/plugin-geocode-osm': () => import('@openrent/plugin-geocode-osm'),
  '@openrent/plugin-search-meilisearch': () => import('@openrent/plugin-search-meilisearch'),
};

export const DEFAULT_PLUGINS_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins.json');

export async function createPluginHost(logger: Logger, opts: { configPath?: string | null; pluginsDir?: string } = {}) {
  const host = new PluginHost(logger);
  await loadPlugins(host, { configPath: opts.configPath ?? DEFAULT_PLUGINS_JSON, pluginsDir: opts.pluginsDir, builtin: BUILTIN });
  return host;
}
