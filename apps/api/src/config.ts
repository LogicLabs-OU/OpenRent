/** Boot-time configuration with a clear error listing every missing or malformed value (PRD §10.2). */
export interface Config {
  databaseUrl: string;
  databaseMigrationUrl: string;
  publicUrl: string;
  adminUrl: string;
  storefrontUrl: string;
  storefrontDomain: string | null;
  encryptionKey: string;
  sessionSecret: string;
  mode: 'single_tenant' | 'multi_tenant';
  port: number;
  host: string;
  logLevel: string;
  trustProxy: boolean;
  autoMigrate: boolean;
  pluginsDir: string;
  pluginsConfig: string | null;
  /** Code themes installed by the operator (`openrent theme install`), one folder each (FR-THM-3). */
  themesDir: string | null;
  /** Owners may install plugins from a ZIP or URL in the admin (FR-PLG-2); off unless the operator allows it. */
  allowPluginUpload: boolean;
  themesConfig: string | null;
  adminDist: string | null;
  widgetDist: string | null;
  operatorKey: string | null;
  /** Requests per minute per API key or session (default 600). */
  rateLimitPerMinute: number;
  corsOrigins: string[];
  livemode: boolean;
  pdfRenderer: 'none' | 'playwright';
  dbPoolMax: number;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

const isUrl = (s: string) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};

export function loadConfig(env: Record<string, string | undefined> = process.env, opts: { requireDatabase?: boolean } = {}): Config {
  const problems: string[] = [];
  const need = (name: string, check?: (v: string) => string | null): string => {
    const v = env[name]?.trim();
    if (!v) {
      problems.push(`${name} is required`);
      return '';
    }
    const p = check?.(v);
    if (p) problems.push(`${name} ${p}`);
    return v;
  };
  const url = (v: string) => (isUrl(v) ? null : 'must be a URL');
  const databaseUrl = opts.requireDatabase === false ? env.DATABASE_URL ?? '' : need('DATABASE_URL', (v) => (/^postgres(ql)?:\/\//.test(v) ? null : 'must start with postgres://'));
  const publicUrl = need('OPENRENT_PUBLIC_URL', url);
  const encryptionKey = need('OPENRENT_ENCRYPTION_KEY', (v) => (Buffer.from(v, 'base64').length === 32 ? null : 'must be 32 random bytes encoded as base64 (run scripts/gen-secrets.sh)'));
  const sessionSecret = need('OPENRENT_SESSION_SECRET', (v) => (v.length >= 32 ? null : 'must be at least 32 characters'));
  const mode = (env.OPENRENT_MODE ?? 'single_tenant') as Config['mode'];
  if (!['single_tenant', 'multi_tenant'].includes(mode)) problems.push('OPENRENT_MODE must be single_tenant or multi_tenant');
  const port = Number(env.PORT ?? 7070);
  if (!Number.isInteger(port) || port <= 0) problems.push('PORT must be a positive integer');
  const pdf = (env.PDF_RENDERER ?? 'playwright') as Config['pdfRenderer'];
  if (!['none', 'playwright'].includes(pdf)) problems.push('PDF_RENDERER must be none or playwright');
  if (problems.length) throw new ConfigError(problems);
  const base = publicUrl.replace(/\/$/, '');
  return {
    databaseUrl,
    databaseMigrationUrl: env.DATABASE_MIGRATION_URL || databaseUrl,
    publicUrl: base,
    adminUrl: (env.ADMIN_URL || `${base}/admin`).replace(/\/$/, ''),
    storefrontUrl: (env.STOREFRONT_URL || base).replace(/\/$/, ''),
    storefrontDomain: env.OPENRENT_STOREFRONT_DOMAIN || null,
    encryptionKey,
    sessionSecret,
    mode,
    port,
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: (env.TRUST_PROXY ?? 'true') === 'true',
    autoMigrate: (env.AUTO_MIGRATE ?? 'true') === 'true',
    pluginsDir: env.PLUGINS_DIR ?? '/plugins',
    pluginsConfig: env.PLUGINS_CONFIG ?? null,
    allowPluginUpload: (env.OPENRENT_ALLOW_PLUGIN_UPLOAD ?? 'false') === 'true',
    themesConfig: env.THEMES_CONFIG ?? null,
    themesDir: env.THEMES_DIR || null,
    adminDist: env.ADMIN_DIST ?? null,
    widgetDist: env.WIDGET_DIST ?? null,
    operatorKey: env.OPENRENT_OPERATOR_KEY || null,
    rateLimitPerMinute: Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE) || 600),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    livemode: (env.OPENRENT_LIVEMODE ?? 'false') === 'true',
    pdfRenderer: pdf,
    dbPoolMax: Math.max(1, Number(env.DATABASE_POOL_MAX ?? 10) || 10),
  };
}
