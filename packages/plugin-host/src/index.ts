import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import {
  HookVeto,
  PLUGIN_API_VERSION,
  type AdminSlot,
  type DomainEvent,
  type EventHandler,
  type HookContext,
  type HookHandler,
  type HookName,
  type Logger,
  type NotificationChannel,
  type PaymentProvider,
  type StorageProvider,
  type TaxProvider,
  type IdentityProvider,
  type SearchProvider,
  type SignatureProvider,
  type ScheduleHandler,
  type StorefrontExtensions,
  type PluginMigration,
  type PluginDefinition,
  validateManifest,
  type PluginRoute,
  type PluginRuntime,
} from '@openrent/plugin-sdk';

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  compat: string;
  state: 'loaded' | 'errored' | 'incompatible' | 'disabled';
  error?: string;
  permissions: string[];
  settings: PluginDefinition['settings'];
  provides: string[];
  /** Manifest problems that did not stop loading (unknown or deprecated keys). */
  warnings: string[];
  jobs: { name: string; cron: string }[];
}

interface Registered<T> {
  pluginId: string;
  handler: T;
}

const HOOK_TIMEOUT_MS = 5000;

/**
 * Plugin host (PRD §7.9). Plugins run in-process but each failure is isolated: a throwing hook is
 * logged and recorded, never failing the core operation, unless it throws HookVeto on purpose.
 */
export class PluginHost implements PluginRuntime {
  private readonly payment = new Map<string, Registered<PaymentProvider>>();
  /** Several plugins may send email; each shop picks one (settings.email_channel). */
  private readonly channels = new Map<string, Registered<NotificationChannel>[]>();
  private storage: Registered<StorageProvider> | null = null;
  private tax: Registered<TaxProvider> | null = null;
  private identity: Registered<IdentityProvider> | null = null;
  private search: Registered<SearchProvider> | null = null;
  private signature: Registered<SignatureProvider> | null = null;
  /** Plugin cron jobs; the worker runs each for every shop that has the plugin on (FR-PLG-8). */
  readonly schedules: { pluginId: string; name: string; cron: string; handler: ScheduleHandler }[] = [];
  readonly migrations: { pluginId: string; migrations: PluginMigration[] }[] = [];
  /** Admin translation catalogues of plugins, by plugin id. */
  readonly locales = new Map<string, Record<string, Record<string, string>>>();
  private readonly hooks: Record<'before' | 'after', Map<HookName, Registered<HookHandler>[]>> = { before: new Map(), after: new Map() };
  private readonly events = new Map<string, Registered<EventHandler>[]>();
  private readonly defaults = new Map<string, Record<string, unknown>>();
  private readonly owners = new Map<string, string>();
  readonly routes: Registered<PluginRoute>[] = [];
  readonly slots: { pluginId: string; slot: AdminSlot; bundleUrl: string; element: string }[] = [];
  private readonly sfExtensions: { pluginId: string; ext: StorefrontExtensions }[] = [];
  /** Folder of each plugin installed from PLUGINS_DIR (admin bundles are served from it). */
  readonly dirs = new Map<string, string>();
  readonly statuses: PluginStatus[] = [];
  readonly hookErrors: { pluginId: string; hook: string; error: string; at: string }[] = [];
  /**
   * `tenant:plugin` pairs a tenant switched off. Loaded from the plugins table and refreshed in the
   * background so hooks never wait for a database round trip inside a request.
   */
  private disabledPairs = new Set<string>();
  private loadDisabled: (() => Promise<{ tenantId: string; pluginId: string }[]>) | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly disabled: Set<string> = new Set((process.env.OPENRENT_DISABLED_PLUGINS ?? '').split(',').filter(Boolean)),
  ) {}

  async register(def: PluginDefinition, warnings: string[] = []): Promise<PluginStatus> {
    const status: PluginStatus = {
      id: def.id, name: def.name, version: def.version, compat: def.compat, state: 'loaded', permissions: def.permissions ?? [], settings: def.settings ?? [], provides: [],
      warnings: [...warnings], jobs: def.jobs ?? [],
    };
    this.statuses.push(status);
    if (this.disabled.has(def.id)) {
      status.state = 'disabled';
      return status;
    }
    if (!semver.validRange(def.compat) || !semver.satisfies(PLUGIN_API_VERSION, def.compat)) {
      status.state = 'incompatible';
      status.error = `requires plugin API ${def.compat}; this OpenRent provides ${PLUGIN_API_VERSION}`;
      this.logger.warn({ plugin: def.id, compat: def.compat }, 'plugin incompatible, not loaded');
      return status;
    }
    const pluginId = def.id;
    try {
      await def.setup({
        logger: this.logger,
        registerPaymentProvider: (p) => {
          this.payment.set(p.id, { pluginId, handler: p });
          this.owners.set(p.id, pluginId);
          status.provides.push(`payment:${p.id}`);
        },
        registerNotificationChannel: (c) => {
          this.channels.set(c.channel, [...(this.channels.get(c.channel) ?? []).filter((r) => r.handler.id !== c.id), { pluginId, handler: c }]);
          this.owners.set(c.id, pluginId);
          status.provides.push(`notification:${c.channel}`);
        },
        registerStorageProvider: (s) => {
          this.storage = { pluginId, handler: s };
          this.owners.set(s.id, pluginId);
          status.provides.push(`storage:${s.id}`);
        },
        registerTaxProvider: (p) => {
          this.tax = { pluginId, handler: p };
          this.owners.set(p.id, pluginId);
          status.provides.push(`tax:${p.id}`);
        },
        registerIdentityProvider: (p) => {
          this.identity = { pluginId, handler: p };
          this.owners.set(p.id, pluginId);
          status.provides.push(`identity:${p.id}`);
        },
        registerSearchProvider: (p) => {
          this.search = { pluginId, handler: p };
          this.owners.set(p.id, pluginId);
          status.provides.push(`search:${p.id}`);
        },
        registerSignatureProvider: (p) => {
          this.signature = { pluginId, handler: p };
          this.owners.set(p.id, pluginId);
          status.provides.push(`signature:${p.id}`);
        },
        schedule: (name, cron, handler) => {
          this.schedules.push({ pluginId, name, cron, handler });
          if (!status.jobs.some((j) => j.name === name)) status.jobs.push({ name, cron });
        },
        before: (hook, handler) => this.addHook('before', hook, pluginId, handler),
        after: (hook, handler) => this.addHook('after', hook, pluginId, handler),
        on: (type, handler) => this.events.set(type, [...(this.events.get(type) ?? []), { pluginId, handler }]),
        route: (route) => {
          this.routes.push({ pluginId, handler: route });
          status.provides.push(`route:${route.method} ${route.path}`);
        },
        adminSlot: (slot, bundleUrl, element) => {
          this.slots.push({ pluginId, slot, bundleUrl, element: element ?? defaultElement(pluginId, slot) });
          status.provides.push(`admin:${slot}`);
        },
        storefront: (ext) => {
          this.sfExtensions.push({ pluginId, ext });
          if (ext.checkoutFields?.length) status.provides.push('storefront:checkout_fields');
          if (ext.productBadges?.length) status.provides.push('storefront:badges');
          if (ext.scripts?.length) status.provides.push('storefront:scripts');
        },
        env: (name) => this.env[name],
        setDefaultConfig: (config) => this.defaults.set(pluginId, config),
      });
      if (def.migrations?.length) this.migrations.push({ pluginId, migrations: def.migrations });
      // Bundles a manifest declares are served from the plugin's folder (GET /plugins/{id}/ui/{file}).
      for (const a of def.admin ?? []) {
        if (this.slots.some((x) => x.pluginId === pluginId && x.slot === a.slot)) continue;
        this.slots.push({ pluginId, slot: a.slot, bundleUrl: `/api/v1/plugins/${pluginId}/ui/${a.file}`, element: a.element ?? defaultElement(pluginId, a.slot) });
        status.provides.push(`admin:${a.slot}`);
      }
      if (def.locales) this.locales.set(pluginId, def.locales);
    } catch (err: any) {
      status.state = 'errored';
      status.error = String(err?.message ?? err);
      this.logger.error({ plugin: def.id, err }, 'plugin setup failed');
    }
    return status;
  }

  /** Sets where tenant enablement comes from, loads it and refreshes it every 15 s. */
  async useEnablementSource(load: () => Promise<{ tenantId: string; pluginId: string }[]>) {
    this.loadDisabled = load;
    await this.refreshEnablement();
    setInterval(() => void this.refreshEnablement(), 15_000).unref();
  }

  async refreshEnablement() {
    if (!this.loadDisabled) return;
    try {
      this.disabledPairs = new Set((await this.loadDisabled()).map((r) => `${r.tenantId}:${r.pluginId}`));
    } catch (err) {
      this.logger.warn({ err }, 'could not load plugin enablement');
    }
  }

  isEnabledFor(tenantId: string, pluginId: string): boolean {
    return !this.disabledPairs.has(`${tenantId}:${pluginId}`);
  }

  private addHook(phase: 'before' | 'after', hook: HookName, pluginId: string, handler: HookHandler) {
    const m = this.hooks[phase];
    m.set(hook, [...(m.get(hook) ?? []), { pluginId, handler }]);
  }

  paymentProvider(id: string) {
    return this.payment.get(id)?.handler;
  }

  paymentProviders() {
    return [...this.payment.values()].map((r) => r.handler);
  }

  notificationChannel(channel: 'email' | 'sms') {
    return this.channels.get(channel)?.[0]?.handler;
  }

  notificationChannels(channel: 'email' | 'sms') {
    return (this.channels.get(channel) ?? []).map((r) => r.handler);
  }

  storageProvider() {
    return this.storage?.handler;
  }

  storefrontExtensions() {
    return this.sfExtensions;
  }

  taxProvider() {
    return this.tax?.handler;
  }

  identityProvider() {
    return this.identity?.handler;
  }

  searchProvider() {
    return this.search?.handler;
  }

  signatureProvider() {
    return this.signature?.handler;
  }

  defaultConfig(pluginId: string) {
    return this.defaults.get(pluginId) ?? {};
  }

  pluginIdOf(providerId: string) {
    return this.owners.get(providerId);
  }

  async runHook(phase: 'before' | 'after', name: HookName, payload: unknown, ctx: HookContext): Promise<void> {
    for (const h of this.hooks[phase].get(name) ?? []) {
      if (!this.isEnabledFor(ctx.tenantId, h.pluginId)) continue;
      try {
        await withTimeout(Promise.resolve(h.handler(payload, scoped(ctx, h.pluginId))), HOOK_TIMEOUT_MS);
      } catch (err: any) {
        if (err instanceof HookVeto && phase === 'before') throw err;
        this.recordFailure(h.pluginId, `${phase}:${name}`, err);
      }
    }
  }

  async dispatch(event: DomainEvent, ctx: HookContext): Promise<void> {
    const handlers = [...(this.events.get(event.type) ?? []), ...(this.events.get('*') ?? [])];
    for (const h of handlers) {
      if (!this.isEnabledFor(ctx.tenantId, h.pluginId)) continue;
      try {
        await withTimeout(Promise.resolve(h.handler(event, scoped(ctx, h.pluginId))), HOOK_TIMEOUT_MS);
      } catch (err) {
        this.recordFailure(h.pluginId, `event:${event.type}`, err);
      }
    }
  }

  /** Runs one plugin's scheduled job for one shop, isolated like a hook (a minute at most). */
  async runSchedule(job: { pluginId: string; name: string; handler: ScheduleHandler }, ctx: HookContext) {
    if (!this.isEnabledFor(ctx.tenantId, job.pluginId)) return;
    try {
      await withTimeout(Promise.resolve(job.handler(scoped(ctx, job.pluginId))), 60_000);
    } catch (err) {
      this.recordFailure(job.pluginId, `schedule:${job.name}`, err);
    }
  }

  recordFailure(pluginId: string, hook: string, err: any) {
    const error = String(err?.message ?? err);
    this.logger.error({ plugin: pluginId, hook, err }, 'plugin hook failed (isolated)');
    this.hookErrors.unshift({ pluginId, hook, error, at: new Date().toISOString() });
    this.hookErrors.splice(50);
  }
}

const defaultElement = (pluginId: string, slot: string) => `${pluginId}-${slot.replace(/[._]/g, '-')}`;

/** The context one plugin sees: its own scope, never another plugin's. */
function scoped(ctx: HookContext, pluginId: string): HookContext {
  const { scopeFor, ...rest } = ctx;
  return scopeFor ? { ...rest, scope: scopeFor(pluginId) } : rest;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`hook timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface PluginsConfig {
  plugins: (string | { package: string; enabled?: boolean })[];
}

/**
 * Loads plugins listed in plugins.json. First-party packages resolve through `builtin`
 * (so bundlers include them); anything else is imported from PLUGINS_DIR.
 */
export async function loadPlugins(
  host: PluginHost,
  opts: { configPath?: string; pluginsDir?: string; builtin: Record<string, () => Promise<{ default: PluginDefinition }>> },
): Promise<PluginStatus[]> {
  let config: PluginsConfig = { plugins: Object.keys(opts.builtin) };
  if (opts.configPath && existsSync(opts.configPath)) config = JSON.parse(await readFile(opts.configPath, 'utf8'));
  for (const entry of config.plugins) {
    const name = typeof entry === 'string' ? entry : entry.package;
    if (typeof entry === 'object' && entry.enabled === false) continue;
    try {
      const loader = opts.builtin[name];
      if (loader) {
        await host.register((await loader()).default);
        continue;
      }
      const dir = path.resolve(opts.pluginsDir ?? 'plugins', name);
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      // An installed plugin describes itself in openrent.plugin.json; its code is loaded only if that is valid.
      let def: PluginDefinition;
      let warnings: string[] = [];
      const manifestFile = path.join(dir, 'openrent.plugin.json');
      if (existsSync(manifestFile)) {
        const check = validateManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
        if (!check.manifest) throw new Error(`openrent.plugin.json: ${check.errors.join('; ')}`);
        warnings = check.warnings;
        const mod: { default: PluginDefinition } = await import(pathToFileURL(path.join(dir, pkg.main ?? 'index.js')).href);
        const { migrationsDir, ...manifest } = check.manifest;
        def = { ...mod.default, ...manifest, migrations: migrationsDir ? await readMigrations(path.join(dir, migrationsDir)) : mod.default.migrations };
      } else {
        def = (await import(pathToFileURL(path.join(dir, pkg.main ?? 'index.js')).href)).default;
        warnings = ['no openrent.plugin.json: add one so the plugin can be checked before it runs'];
      }
      host.dirs.set(def.id, dir);
      await host.register(def, warnings);
    } catch (err: any) {
      host.statuses.push({ id: name, name, version: '?', compat: '?', state: 'errored', error: String(err?.message ?? err), permissions: [], settings: [], provides: [], warnings: [], jobs: [] });
    }
  }
  return host.statuses;
}

async function readMigrations(dir: string): Promise<PluginMigration[]> {
  if (!existsSync(dir)) return [];
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map(async (f) => ({ name: f.replace(/\.sql$/, ''), sql: await readFile(path.join(dir, f), 'utf8') })));
}

export { HookVeto };
