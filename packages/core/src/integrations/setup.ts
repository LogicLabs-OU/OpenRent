import type { IntegrationLookups, IntegrationProvider, LookupItem } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, must } from '../sql.ts';
import { startOfLocalDay } from '../time.ts';
import { catchUp, contextFor, getConnection, providerOrThrow } from './index.ts';

/**
 * Setting up an accounting system (ADR 0009): the organisation, a mapping from OpenRent's accounts and
 * tax rates to the organisation's own (picked from lists the system returns, not typed), a check that
 * the mapping still fits, and starting or pausing the sync.
 */
const LOOKUP_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: IntegrationLookups }>();

async function liveAccounting(ctx: Ctx, id: string) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1 AND status IN ('connected', 'error')`, [id], 'integration_connection', id);
  const p = providerOrThrow(ctx, c.provider_id);
  return { c, p };
}

/** What the connected organisation offers to map to; cached for ten minutes unless `refresh`. */
export async function lookups(ctx: Ctx, id: string, refresh = false): Promise<IntegrationLookups> {
  const { c, p } = await liveAccounting(ctx, id);
  if (!p.lookups) return {};
  const key = `${c.id}:${c.account?.organisation_id ?? ''}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.data;
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  try {
    const data = await p.lookups(ictx);
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('integration_unreachable', 502, msg('integrations.lookups_failed', { name: p.name, reason: (e as Error).message.slice(0, 300) }));
  } finally {
    await saveTokens();
  }
}

/** Every tax rate the shop can charge (its tax profiles), plus 0 % for untaxed lines. */
async function ratesInUse(ctx: Ctx): Promise<number[]> {
  const profiles = await many<{ rates: { rate_bp?: number }[] }>(ctx, `SELECT rates FROM tax_profiles WHERE deleted_at IS NULL`);
  const booked = await many<{ r: number }>(ctx, `SELECT DISTINCT tax_rate_bp AS r FROM accounting_entry_lines WHERE tax_rate_bp IS NOT NULL`);
  const set = new Set<number>([0]);
  for (const p of profiles) set.add((p.rates ?? []).reduce((a, x) => a + Number(x.rate_bp ?? 0), 0));
  for (const b of booked) set.add(Number(b.r));
  return [...set].sort((a, b) => a - b);
}

const LIST: Record<string, keyof IntegrationLookups> = { accounts: 'accounts', items: 'items', paymentAccounts: 'paymentAccounts' };

/**
 * Field errors for a mapping, against the organisation's current lists: missing required choices,
 * records that no longer exist, accounts of the wrong type, tax rates without a match, a currency the
 * organisation cannot invoice in.
 */
export async function mappingErrors(ctx: Ctx, p: IntegrationProvider, mapping: Record<string, unknown>, data: IntegrationLookups): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  const find = (list: LookupItem[] | undefined, id: unknown) => (typeof id === 'string' ? list?.find((x) => x.id === id) : undefined);
  for (const slot of p.mapping ?? []) {
    const v = mapping[slot.key];
    const field = `mapping.${slot.key}`;
    if (!v) {
      if (slot.required) errors.push({ field, code: 'required', message: msg('integrations.mapping_required') });
      continue;
    }
    const item = find(data[LIST[slot.list]!] as LookupItem[] | undefined, v);
    if (!item) errors.push({ field, code: 'not_found', message: msg('integrations.mapping_gone') });
    else if (slot.types?.length && item.type && !slot.types.includes(item.type)) errors.push({ field, code: 'wrong_type', message: msg('integrations.mapping_wrong_type', { type: item.type }) });
  }
  if (p.mapsTaxes) {
    for (const rate of await ratesInUse(ctx)) {
      const field = `mapping.taxes.${rate}`;
      const v = mapping[`taxes.${rate}`];
      const item = find(data.taxRates, v);
      if (!v) errors.push({ field, code: 'required', message: msg('integrations.mapping_tax_required', { rate: rate / 100 }) });
      else if (!item) errors.push({ field, code: 'not_found', message: msg('integrations.mapping_gone') });
      else if (item.rateBp !== undefined && item.rateBp !== rate) errors.push({ field, code: 'wrong_rate', message: msg('integrations.mapping_tax_rate', { rate: rate / 100, theirs: item.rateBp / 100 }) });
    }
  }
  if (data.currencies?.length) {
    const t = await must<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
    if (!data.currencies.includes(String(t.currency).trim())) errors.push({ field: 'currency', code: 'currency', message: msg('integrations.currency_missing', { currency: String(t.currency).trim(), name: p.name }) });
  }
  return errors;
}

/** Saves the shop's choices; refuses choices that do not exist or do not fit. Partial saves are fine. */
export async function saveMapping(ctx: Ctx, id: string, mapping: Record<string, string | null>) {
  const { c, p } = await liveAccounting(ctx, id);
  const allowed = new Set((p.mapping ?? []).map((s) => s.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (!(allowed.has(k) || (p.mapsTaxes && /^taxes\.\d{1,5}$/.test(k)))) continue;
    if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
  }
  const data = await lookups(ctx, id);
  // Only the choices sent are checked here; completeness is checked when syncing starts.
  const errors = (await mappingErrors(ctx, p, clean, data)).filter((e) => e.code !== 'required' && e.field !== 'currency');
  if (errors.length) throw invalid(msg('integrations.check_mapping'), errors);
  const before = c.settings?.mapping ?? {};
  const merged = { ...before };
  for (const k of Object.keys(mapping)) if (allowed.has(k) || k.startsWith('taxes.')) delete merged[k];
  Object.assign(merged, clean);
  await exec(ctx, `UPDATE integration_connections SET settings = settings || jsonb_build_object('mapping', $2::jsonb) WHERE id = $1`, [id, json(merged)]);
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'map', before, after: merged });
  return getConnection(ctx, id);
}

/** Whether the mapping is complete and still fits the organisation; the errors say what to fix. */
export async function setupCheck(ctx: Ctx, id: string) {
  const { c, p } = await liveAccounting(ctx, id);
  const errors = p.lookups ? await mappingErrors(ctx, p, c.settings?.mapping ?? {}, await lookups(ctx, id)) : [];
  return { object: 'setup_check', ready: errors.length === 0, errors, rates: p.mapsTaxes ? await ratesInUse(ctx) : [] };
}

/**
 * Starts sending entries from `from` (a date). Entries booked since then are queued now; new ones
 * follow as they are booked.
 */
export async function startSync(ctx: Ctx, id: string, input: { from: string }) {
  const { c, p } = await liveAccounting(ctx, id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? '') || Number.isNaN(Date.parse(input.from))) {
    throw invalid(msg('integrations.check_mapping'), [{ field: 'from', code: 'invalid', message: msg('error.field.invalid_date_time') }]);
  }
  const check = await setupCheck(ctx, id);
  if (!check.ready) throw invalid(msg('integrations.check_mapping'), check.errors);
  // The start date is a day in the shop's time zone.
  const tz = (await must<{ timezone: string }>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).timezone;
  const start = startOfLocalDay(input.from, tz);
  await exec(ctx, `UPDATE integration_connections SET settings = settings || '{"sync_enabled": true}'::jsonb, sync_from = $2 WHERE id = $1`, [id, start]);
  const queued = p.events.includes('accounting.entry_posted') ? (await catchUp(ctx, id, start.toISOString())).queued : 0;
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'start_sync', before: { sync_enabled: c.settings?.sync_enabled === true }, extra: { from: input.from, queued } });
  return { ...(await getConnection(ctx, id)), queued };
}

/** Stops sending (tasks already queued wait); starting again picks up where it stopped. */
export async function pauseSync(ctx: Ctx, id: string) {
  await liveAccounting(ctx, id);
  await exec(ctx, `UPDATE integration_connections SET settings = settings || '{"sync_enabled": false}'::jsonb WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'pause_sync' });
  return getConnection(ctx, id);
}

/** Switches to another organisation the sign-in gave access to. Mapping and sync start over. */
export async function chooseOrganisation(ctx: Ctx, id: string, organisationId: string) {
  const { c, p } = await liveAccounting(ctx, id);
  const known = (c.account?.organisations ?? []) as { id: string; name: string }[];
  if (!p.useOrganisation || !known.some((o) => o.id === organisationId)) {
    throw invalid(msg('integrations.check_mapping'), [{ field: 'organisation_id', code: 'not_found', message: msg('integrations.mapping_gone') }]);
  }
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  let info: { accountName?: string; account?: Record<string, unknown> };
  try {
    info = await p.useOrganisation(ictx, organisationId);
  } finally {
    await saveTokens();
  }
  await exec(
    ctx,
    `UPDATE integration_connections SET account_name = $2, account = $3, settings = (settings - 'mapping') || '{"sync_enabled": false}'::jsonb WHERE id = $1`,
    [id, info.accountName ?? c.account_name, json({ ...(info.account ?? {}), organisation_id: organisationId, organisations: known })],
  );
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'choose_organisation', before: { organisation_id: c.account?.organisation_id ?? null }, after: { organisation_id: organisationId } });
  return getConnection(ctx, id);
}

/**
 * Daily: refreshes OAuth tokens that have not been used for a while, so connections whose refresh
 * token expires when idle (Xero: 60 days) keep working.
 */
export async function keepAlive(ctx: Ctx, idleDays = 14) {
  const conns = await many<any>(ctx, `SELECT * FROM integration_connections WHERE status IN ('connected', 'error') AND credentials_encrypted IS NOT NULL`);
  let refreshed = 0;
  for (const c of conns) {
    const p = ctx.plugins.integration(c.provider_id);
    if (p?.auth.type !== 'oauth2') continue;
    const creds = JSON.parse(ctx.secrets.decrypt(c.credentials_encrypted));
    const last = Number(creds.refreshed_at ?? creds.expires_at - 3600_000);
    if (Date.now() - last < idleDays * 86_400_000) continue;
    const { refresh, saveTokens } = await contextFor(ctx, c, p);
    try {
      await refresh();
      await saveTokens();
      refreshed++;
    } catch (e) {
      ctx.logger.warn({ err: e, connection: c.id }, 'integration token keep-alive failed');
      await exec(ctx, `UPDATE integration_connections SET status = 'error', last_error = $2 WHERE id = $1`, [c.id, msg('integrations.reconnect', { name: p.name })]);
    }
  }
  return refreshed;
}

/** The live accounting connection of the shop, if there is one. */
export async function accountingConnection(ctx: Ctx) {
  for (const c of await many<any>(ctx, `SELECT * FROM integration_connections WHERE status <> 'disconnected' ORDER BY created_at DESC`)) {
    const p = ctx.plugins.integration(c.provider_id);
    if (p?.category === 'accounting') return { c, p };
  }
  return null;
}

