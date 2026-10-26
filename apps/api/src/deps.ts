import type { Database } from '@openrent/db';
import type { PluginHost } from '@openrent/plugin-host';
import type { SecretBox, themes } from '@openrent/core';
import type { Config } from './config.ts';

export interface AppDeps {
  config: Config;
  db: Database;
  plugins: PluginHost;
  /** Installed storefront themes (manifests, settings schemas, strings). */
  themes: themes.InstalledTheme[];
  secrets: SecretBox;
  version: string;
}
