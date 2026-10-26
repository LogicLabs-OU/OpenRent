import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost, loadPlugins } from '@openrent/plugin-host';
import type { Logger } from '@openrent/plugin-sdk';

/** First-party plugins resolve statically so bundlers include them. */
const BUILTIN = {
  '@openrent/plugin-payment-stripe': () => import('@openrent/plugin-payment-stripe'),
  '@openrent/plugin-notify-smtp': () => import('@openrent/plugin-notify-smtp'),
  '@openrent/plugin-notify-postmark': () => import('@openrent/plugin-notify-postmark'),
  '@openrent/plugin-notify-resend': () => import('@openrent/plugin-notify-resend'),
  '@openrent/plugin-storage-s3': () => import('@openrent/plugin-storage-s3'),
};

export const DEFAULT_PLUGINS_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins.json');

export async function createPluginHost(logger: Logger, opts: { configPath?: string | null; pluginsDir?: string } = {}) {
  const host = new PluginHost(logger);
  await loadPlugins(host, { configPath: opts.configPath ?? DEFAULT_PLUGINS_JSON, pluginsDir: opts.pluginsDir, builtin: BUILTIN });
  return host;
}
