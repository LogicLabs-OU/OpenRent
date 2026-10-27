import type { SettingsField } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { assertWithinLimit } from '../tenancy/operator.ts';
import { exec, json, one } from '../sql.ts';

/** What the plugin host knows about an installed plugin (passed in by the API). */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  compat: string;
  state: 'loaded' | 'errored' | 'incompatible' | 'disabled';
  error?: string;
  permissions: string[];
  settings?: SettingsField[];
  provides: string[];
  warnings?: string[];
  jobs?: { name: string; cron: string }[];
}

/** Secret settings are stored sealed under this key of `plugins.config`. */
const SEALED = '__sealed';

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function openStored(ctx: Ctx, config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!config) return {};
  const { [SEALED]: sealed, ...plain } = config;
  const secrets = typeof sealed === 'string' && sealed ? (JSON.parse(ctx.secrets.decrypt(sealed)) as Record<string, unknown>) : {};
  return { ...plain, ...secrets };
}

/** Tenant row for a plugin; no row means enabled with installation defaults. */
async function tenantRow(ctx: Ctx, pluginId: string) {
  return one<{ id: string; enabled: boolean; config: Record<string, unknown> }>(ctx, `SELECT id, enabled, config FROM plugins WHERE plugin_id = $1`, [pluginId]);
}

/** Effective configuration: installation defaults (env) overridden by the tenant's saved settings. */
/** Settings that say where a plugin connects to (`api_base_url`, `host`, `nominatim_url` …). */
const ENDPOINT = /(^|_)(url|host|endpoint)$/i;

export async function pluginConfig(ctx: Ctx, pluginId: string): Promise<{ enabled: boolean; config: Record<string, unknown> }> {
  const row = await tenantRow(ctx, pluginId);
  const own = openStored(ctx, row?.config);
  // On a multi-shop installation, a shop that points a plugin somewhere else gets none of the
  // installation's defaults: the operator's keys never travel to a host a shop chose.
  const pointed = ctx.config.multiTenant && Object.entries(own).some(([k, v]) => ENDPOINT.test(k) && v !== null && v !== '');
  return { enabled: row ? row.enabled : true, config: { ...(pointed ? {} : clean(ctx.plugins.defaultConfig(pluginId))), ...own } };
}

export async function isPluginEnabled(ctx: Ctx, pluginId: string): Promise<boolean> {
  return (await tenantRow(ctx, pluginId))?.enabled ?? true;
}

async function toApi(ctx: Ctx, p: InstalledPlugin) {
  const row = await tenantRow(ctx, p.id);
  const stored = openStored(ctx, row?.config);
  const defaults = clean(ctx.plugins.defaultConfig(p.id));
  const fields = p.settings ?? [];
  // Secrets never leave the server: only where each one comes from.
  const values: Record<string, unknown> = {};
  const secrets: Record<string, 'tenant' | 'installation' | null> = {};
  for (const f of fields) {
    if (f.type === 'secret') secrets[f.key] = f.key in stored ? 'tenant' : f.key in defaults ? 'installation' : null;
    else values[f.key] = stored[f.key] ?? defaults[f.key] ?? null;
  }
  return {
    id: p.id,
    object: 'plugin',
    name: p.name,
    version: p.version,
    compat: p.compat,
    state: p.state,
    error: p.error ?? null,
    permissions: p.permissions,
    provides: p.provides,
    warnings: p.warnings ?? [],
    jobs: p.jobs ?? [],
    enabled: row ? row.enabled : true,
    settings: fields,
    values,
    secrets,
  };
}

export async function listPlugins(ctx: Ctx, installed: InstalledPlugin[]) {
  return Promise.all(installed.map((p) => toApi(ctx, p)));
}

export async function getPlugin(ctx: Ctx, installed: InstalledPlugin[], id: string) {
  const p = installed.find((x) => x.id === id);
  if (!p) throw new AppError('not_found', 404, t('plugins.not_installed', { id }));
  return toApi(ctx, p);
}

function validate(fields: SettingsField[], patch: Record<string, unknown>): Record<string, unknown> {
  const errors: FieldError[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const f = fields.find((x) => x.key === key);
    if (!f) {
      errors.push({ field: `config.${key}`, code: 'unknown', message: t('plugins.unknown_setting') });
      continue;
    }
    if (raw === null || raw === '') {
      out[key] = null;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) errors.push({ field: `config.${key}`, code: 'invalid', message: t('plugins.invalid_number') });
        else out[key] = n;
        break;
      }
      case 'boolean': {
        // The API's body schema may hand a boolean over as "true"/"false" (its value types are a union).
        const v = raw === 'true' ? true : raw === 'false' ? false : raw;
        if (typeof v !== 'boolean') errors.push({ field: `config.${key}`, code: 'invalid', message: t('plugins.invalid_boolean') });
        else out[key] = v;
        break;
      }
      case 'select':
        if (!f.options?.includes(String(raw))) errors.push({ field: `config.${key}`, code: 'invalid', message: t('plugins.invalid_option', { options: (f.options ?? []).join(', ') }) });
        else out[key] = String(raw);
        break;
      default:
        out[key] = String(raw);
    }
  }
  if (errors.length) throw invalid(t('plugins.invalid_settings'), errors);
  return out;
}

/** Enables, disables or configures a plugin for the current tenant. `null` or "" clears a setting. */
export async function updatePlugin(ctx: Ctx, installed: InstalledPlugin[], id: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) {
  const p = installed.find((x) => x.id === id);
  if (!p) throw new AppError('not_found', 404, t('plugins.not_installed', { id }));
  if (patch.enabled && p.state !== 'loaded') throw new AppError('plugin_not_loaded', 409, t('plugins.not_loaded', { id, state: p.state }));
  const fields = p.settings ?? [];
  const changes = validate(fields, patch.config ?? {});
  const row = await tenantRow(ctx, id);
  // A plugin the shop turns on (or sets up, which turns it on) counts against its plan.
  if ((patch.enabled ?? row?.enabled ?? true) && row?.enabled !== true) await assertWithinLimit(ctx, 'plugins');
  const merged = { ...openStored(ctx, row?.config), ...changes };
  const plain: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === undefined) continue;
    if (fields.find((f) => f.key === k)?.type === 'secret') secret[k] = v;
    else plain[k] = v;
  }
  const config = { ...plain, ...(Object.keys(secret).length ? { [SEALED]: ctx.secrets.encrypt(JSON.stringify(secret)) } : {}) };
  if (row) {
    await exec(ctx, `UPDATE plugins SET enabled = coalesce($2, enabled), config = $3, version = $4 WHERE id = $1`, [row.id, patch.enabled ?? null, json(config), p.version]);
  } else {
    await exec(ctx, `INSERT INTO plugins (id, tenant_id, plugin_id, version, enabled, config) VALUES ($1,$2,$3,$4,$5,$6)`, [newId('plg'), ctx.tenantId, id, p.version, patch.enabled ?? true, json(config)]);
  }
  await audit(ctx, { entity_type: 'plugin', entity_id: id, action: 'update', extra: { enabled: patch.enabled, keys: Object.keys(changes) } });
  return toApi(ctx, p);
}

/** Admin extensions of the plugins this shop has on, in load order. */
export async function adminSlots(ctx: Ctx, slots: { pluginId: string; slot: string; bundleUrl: string; element: string }[]) {
  const out = [];
  for (const s of slots) {
    if (!(await pluginConfig(ctx, s.pluginId)).enabled) continue;
    out.push({ object: 'plugin_slot', plugin_id: s.pluginId, slot: s.slot, url: s.bundleUrl, element: s.element });
  }
  return out;
}

/** A provider a plugin registered, when this shop has that plugin on and set up; null otherwise. */
export async function enabledProvider<P extends { id: string; isConfigured(ctx: { tenantId: string; config: Record<string, unknown>; logger: any }): boolean }>(ctx: Ctx, provider: P | undefined) {
  if (!provider) return null;
  const pluginId = ctx.plugins.pluginIdOf(provider.id) ?? provider.id;
  const { enabled, config } = await pluginConfig(ctx, pluginId);
  const pctx = { tenantId: ctx.tenantId, config, logger: ctx.logger };
  return enabled && provider.isConfigured(pctx) ? { provider, pctx, pluginId } : null;
}

/** The tax plugin a shop uses: the first that is on and set up for it; `need` asks for one that checks numbers. */
export async function activeTaxProvider(ctx: Ctx, need?: 'checkTaxId') {
  for (const p of ctx.plugins.taxProviders()) {
    if (need && !p[need]) continue;
    const active = await enabledProvider(ctx, p);
    if (active) return active;
  }
  return null;
}

/**
 * The email channel a shop sends with (FR-NOT-1): the one chosen in settings.email_channel when it is
 * enabled and set up, else the first enabled one that is set up, else the first loaded (to report why).
 */
export async function emailChannel(ctx: Ctx) {
  const all = ctx.plugins.notificationChannels('email');
  if (!all.length) return null;
  const t = await one<{ settings: any }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]);
  const chosen = t?.settings?.email_channel as string | undefined;
  const ready = await channelStates(ctx, all);
  const usable = (r: (typeof ready)[number]) => r.enabled && r.channel.isConfigured({ tenantId: ctx.tenantId, config: r.config, logger: ctx.logger });
  return ready.find((r) => r.pluginId === chosen && usable(r)) ?? ready.find(usable) ?? ready[0]!;
}

/**
 * The SMS or WhatsApp channel a shop sends booking updates with (FR-NOT-4): only the plugin chosen in
 * `settings.sms_channel` / `whatsapp_channel`, and only while it is on and set up; else null.
 */
export async function textChannel(ctx: Ctx, kind: 'sms' | 'whatsapp') {
  const t = await one<{ settings: any }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]);
  const chosen = t?.settings?.[`${kind}_channel`] as string | undefined;
  if (!chosen) return null;
  const ready = await channelStates(ctx, ctx.plugins.notificationChannels(kind));
  return ready.find((r) => r.pluginId === chosen && r.enabled && r.channel.isConfigured({ tenantId: ctx.tenantId, config: r.config, logger: ctx.logger })) ?? null;
}

async function channelStates(ctx: Ctx, all: ReturnType<Ctx['plugins']['notificationChannels']>) {
  const ready: { channel: (typeof all)[number]; pluginId: string; enabled: boolean; config: Record<string, unknown> }[] = [];
  for (const channel of all) {
    const pluginId = ctx.plugins.pluginIdOf(channel.id) ?? channel.id;
    const { enabled, config } = await pluginConfig(ctx, pluginId);
    ready.push({ channel, pluginId, enabled, config });
  }
  return ready;
}

