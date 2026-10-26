import type { AdminSlot, PluginManifest, SettingsField } from './index.ts';

/**
 * `openrent.plugin.json` (FR-PLG-7): what a plugin is and needs, readable without running its code.
 * Errors stop the plugin from loading; warnings (unknown or deprecated keys) show on the plugins page.
 */
export interface ManifestCheck {
  manifest: (PluginManifest & { migrationsDir?: string }) | null;
  errors: string[];
  warnings: string[];
}

export const ADMIN_SLOTS: AdminSlot[] = ['order.sidebar', 'order.actions', 'product.tab', 'customer.tab', 'dashboard.widget', 'settings.page', 'nav.item', 'scan.mode'];
const SETTING_TYPES: SettingsField['type'][] = ['text', 'secret', 'boolean', 'select', 'number'];
/** What a plugin may ask for; shown to the owner before installing (FR-PLG-2). */
export const PLUGIN_PERMISSIONS = [
  'orders:read', 'orders:write', 'customers:read', 'customers:write', 'catalog:read', 'inventory:read', 'payments:read',
  'documents:read', 'reports:read', 'events:emit', 'db:own_tables', 'network', 'storefront:scripts', 'admin:ui',
];
const KNOWN = new Set(['$schema', 'id', 'name', 'version', 'author', 'license', 'compat', 'permissions', 'settings', 'locales', 'admin', 'migrations', 'jobs', 'description', 'homepage', 'main']);
const DEPRECATED: Record<string, string> = {
  admin_bundle: 'use "admin": [{ "slot": …, "file": … }]',
  cron: 'use "jobs": [{ "name": …, "cron": … }] and api.schedule()',
  hooks: 'hooks are registered in code with api.before() and api.after()',
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const CRON = /^(\S+\s+){4}\S+$/;

export function validateManifest(raw: unknown): ManifestCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { manifest: null, errors: ['the manifest must be a JSON object'], warnings };
  const str = (k: string) => (typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string) : null);

  const id = str('id');
  if (!id || !/^[a-z][a-z0-9-]{1,39}$/.test(id)) errors.push('"id" must be 2–40 lowercase letters, digits or dashes, starting with a letter');
  if (!str('name')) errors.push('"name" is required');
  if (!str('version') || !SEMVER.test(str('version')!)) errors.push('"version" must be a semantic version such as 1.0.0');
  if (!str('compat')) errors.push('"compat" must name the plugin API versions it supports, such as ^1.1.0');

  for (const k of Object.keys(raw)) {
    if (DEPRECATED[k]) warnings.push(`"${k}" is deprecated: ${DEPRECATED[k]}`);
    else if (!KNOWN.has(k)) warnings.push(`unknown key "${k}" is ignored`);
  }

  const permissions = raw.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string')) errors.push('"permissions" must be a list of strings');
  else for (const p of permissions) if (!PLUGIN_PERMISSIONS.includes(p)) warnings.push(`unknown permission "${p}"`);

  const settings = raw.settings ?? [];
  if (!Array.isArray(settings)) errors.push('"settings" must be a list');
  else
    settings.forEach((f, i) => {
      if (!isObj(f) || typeof f.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(f.key)) errors.push(`settings[${i}].key must be lowercase letters, digits or underscores`);
      else if (!SETTING_TYPES.includes(f.type as SettingsField['type'])) errors.push(`settings[${i}].type must be one of ${SETTING_TYPES.join(', ')}`);
    });

  if (raw.locales !== undefined && (!isObj(raw.locales) || Object.values(raw.locales).some((c) => !isObj(c) || Object.values(c).some((v) => typeof v !== 'string'))))
    errors.push('"locales" must map languages to { "key": "text" } objects');

  const admin = raw.admin ?? [];
  if (!Array.isArray(admin)) errors.push('"admin" must be a list');
  else
    admin.forEach((a, i) => {
      if (!isObj(a) || !ADMIN_SLOTS.includes(a.slot as AdminSlot)) errors.push(`admin[${i}].slot must be one of ${ADMIN_SLOTS.join(', ')}`);
      else if (typeof a.file !== 'string' || !/\.m?js$/.test(a.file) || a.file.includes('..') || a.file.startsWith('/')) errors.push(`admin[${i}].file must be a .js file inside the plugin`);
      else if (a.element !== undefined && (typeof a.element !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(a.element) || (id && !a.element.startsWith(`${id}-`)))) errors.push(`admin[${i}].element must be a custom element name starting with "${id}-"`);
    });

  const jobs = raw.jobs ?? [];
  if (!Array.isArray(jobs)) errors.push('"jobs" must be a list');
  else
    jobs.forEach((j, i) => {
      if (!isObj(j) || typeof j.name !== 'string' || !/^[a-z][a-z0-9_.-]{0,39}$/.test(j.name)) errors.push(`jobs[${i}].name must be lowercase letters, digits, dots, dashes or underscores`);
      else if (typeof j.cron !== 'string' || !CRON.test(j.cron.trim())) errors.push(`jobs[${i}].cron must have five fields, such as "0 * * * *"`);
    });

  let migrationsDir: string | undefined;
  if (typeof raw.migrations === 'string') {
    if (raw.migrations.includes('..') || raw.migrations.startsWith('/')) errors.push('"migrations" must be a folder inside the plugin');
    else migrationsDir = raw.migrations;
  } else if (raw.migrations !== undefined) errors.push('"migrations" must be the name of a folder of .sql files');

  if (errors.length) return { manifest: null, errors, warnings };
  return {
    manifest: {
      id: id!, name: str('name')!, version: str('version')!, compat: str('compat')!, author: str('author') ?? undefined, license: str('license') ?? undefined,
      permissions: permissions as string[], settings: settings as SettingsField[], locales: raw.locales as PluginManifest['locales'],
      admin: admin as PluginManifest['admin'], jobs: jobs as PluginManifest['jobs'], migrationsDir,
    },
    errors,
    warnings,
  };
}
