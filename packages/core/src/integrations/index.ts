import { createHash, randomBytes } from 'node:crypto';
import type { AccountingEntry, DomainEvent, IntegrationContext, IntegrationProvider, IntegrationTask } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, sha256 } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { pluginConfig } from '../plugins/index.ts';
import { getEntry } from '../accounting/index.ts';
import { localDate } from '../time.ts';
import * as accounting from './accounting.ts';

export { accounting };
export * as setup from './setup.ts';
export * as records from './records.ts';

/**
 * Integrations with other systems (accounting, calendars, CRM…), as a general framework. A plugin
 * registers an integration; a shop connects it (OAuth 2 with PKCE, or typed credentials), and from
 * then on the events the integration asks for become tasks that the worker runs with retries. Which
 * record in the other system an OpenRent record became is kept per connection, so nothing is sent
 * twice. Credentials are sealed; tokens are refreshed as they expire.
 */
const BACKOFF_MIN = [1, 5, 15, 60, 240, 720];
const MAX_ATTEMPTS = 8;
const TASK_TIMEOUT_MS = 30_000;

export function connectionToApi(c: any, p?: IntegrationProvider) {
  const settings = c.settings ?? {};
  return {
    id: c.id, object: 'integration_connection', provider_id: c.provider_id, provider_name: p?.name ?? c.provider_id, category: p?.category ?? null,
    status: c.status, account_name: c.account_name, settings, sync_from: c.sync_from, last_sync_at: c.last_sync_at, last_error: c.last_error,
    // Accounting systems (ADR 0009): which organisation, and whether entries are being sent yet.
    organisation_id: c.account?.organisation_id ?? null, organisations: c.account?.organisations ?? [], sync_enabled: settings.sync_enabled === true,
    created_at: c.created_at, updated_at: c.updated_at,
  };
}

/** Accounting connections send nothing until the shop has mapped its accounts and started syncing. */
export const syncing = (c: any, p: IntegrationProvider | undefined) => p?.category !== 'accounting' || c.settings?.sync_enabled === true;

export function providerOrThrow(ctx: Ctx, id: string) {
  const p = ctx.plugins.integration(id);
  if (!p) throw notFound('integration', id);
  return p;
}

/** Every installed integration, with the shop's connection if there is one. */
export async function listIntegrations(ctx: Ctx) {
  const rows = await many<any>(ctx, `SELECT * FROM integration_connections WHERE status <> 'disconnected'`);
  const out = [];
  for (const p of ctx.plugins.integrations()) {
    const pluginId = ctx.plugins.pluginIdOf(p.id) ?? p.id;
    const { enabled, config } = await pluginConfig(ctx, pluginId);
    const c = rows.find((r) => r.provider_id === p.id);
    const ready = p.auth.type === 'fields' || (!!config[p.auth.clientIdSetting] && !!config[p.auth.clientSecretSetting]);
    out.push({
      object: 'integration', id: p.id, name: p.name, category: p.category, plugin_id: pluginId, enabled, auth: p.auth.type, ready,
      fields: p.auth.type === 'fields' ? p.auth.fields : [], settings_schema: p.settings ?? [], events: p.events, connection: c ? connectionToApi(c, p) : null,
      mapping: p.mapping ?? [], maps_taxes: !!p.mapsTaxes, has_lookups: !!p.lookups, imports_payments: !!p.pullPayments,
    });
  }
  return out;
}

async function liveConnection(ctx: Ctx, providerId: string) {
  return one<any>(ctx, `SELECT * FROM integration_connections WHERE provider_id = $1 AND status <> 'disconnected' FOR UPDATE`, [providerId]);
}

export async function getConnection(ctx: Ctx, id: string) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1`, [id], 'integration_connection', id);
  return connectionToApi(c, ctx.plugins.integration(c.provider_id));
}

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Starts connecting. OAuth 2: returns the provider's authorization URL (state and PKCE kept on a
 * pending connection). Typed credentials: checks them right away and connects.
 */
export async function connect(ctx: Ctx, providerId: string, input: { credentials?: Record<string, string>; redirect_uri: string }) {
  const p = providerOrThrow(ctx, providerId);
  const pluginId = ctx.plugins.pluginIdOf(p.id) ?? p.id;
  const { enabled, config } = await pluginConfig(ctx, pluginId);
  if (!enabled) throw new AppError('plugin_disabled', 409, msg('integrations.plugin_off', { name: p.name }));
  const existing = await liveConnection(ctx, p.id);
  // A connection whose sign-in stopped working (status error) signs in again in place: settings stay.
  if (existing?.status === 'connected' || (existing?.status === 'error' && p.auth.type !== 'oauth2')) throw new AppError('already_connected', 409, msg('integrations.already_connected', { name: p.name }));
  // One accounting system per shop: the books live in one place.
  if (p.category === 'accounting') {
    for (const other of await many<any>(ctx, `SELECT provider_id FROM integration_connections WHERE status IN ('connected', 'error') AND provider_id <> $1`, [p.id])) {
      const op = ctx.plugins.integration(other.provider_id);
      if (op?.category === 'accounting') throw new AppError('accounting_connected', 409, msg('integrations.one_accounting', { name: op.name }));
    }
  }
  const id = existing?.id ?? newId('icn');
  if (!existing) await exec(ctx, `INSERT INTO integration_connections (id, tenant_id, provider_id, status, connected_by) VALUES ($1,$2,$3,'pending',$4)`, [id, ctx.tenantId, p.id, ctx.actor.id]);

  if (p.auth.type === 'oauth2') {
    const clientId = String(config[p.auth.clientIdSetting] ?? '');
    if (!clientId || !config[p.auth.clientSecretSetting]) throw new AppError('integration_not_ready', 409, msg('integrations.needs_client', { name: p.name }));
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    await exec(ctx, `UPDATE integration_connections SET oauth_state_hash = $2, oauth_verifier_encrypted = $3 WHERE id = $1`, [id, sha256(state), ctx.secrets.encrypt(verifier)]);
    const url = new URL(oauthUrl(p.auth.authorizeUrl, config, p.auth.baseUrlSetting));
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: clientId, redirect_uri: input.redirect_uri, scope: p.auth.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...(p.auth.authorizeParams ?? {}),
    }))
      url.searchParams.set(k, v);
    return { object: 'integration_authorization', authorize_url: url.href };
  }

  // Typed credentials: every required field, then a check against the other system.
  const errors: FieldError[] = [];
  const creds: Record<string, string> = {};
  for (const f of p.auth.fields) {
    const v = String(input.credentials?.[f.key] ?? '').trim();
    if (f.required && !v) errors.push({ field: `credentials.${f.key}`, code: 'required', message: msg('integrations.field_required') });
    if (v) creds[f.key] = v;
  }
  if (errors.length) throw invalid(msg('integrations.check_credentials'), errors);
  await exec(ctx, `UPDATE integration_connections SET credentials_encrypted = $2 WHERE id = $1`, [id, ctx.secrets.encrypt(JSON.stringify(creds))]);
  return finishConnecting(ctx, id, {});
}

/** The OAuth redirect came back: trade the code for tokens and connect. */
export async function completeOAuth(ctx: Ctx, input: { state: string; code: string; params: Record<string, string>; redirect_uri: string }) {
  const c = await one<any>(ctx, `SELECT * FROM integration_connections WHERE oauth_state_hash = $1 AND status IN ('pending', 'error') FOR UPDATE`, [sha256(input.state)]);
  if (!c) throw new AppError('integration_state', 400, msg('integrations.link_expired'));
  const p = providerOrThrow(ctx, c.provider_id);
  if (p.auth.type !== 'oauth2') throw new AppError('integration_state', 400, msg('integrations.link_expired'));
  const { config } = await pluginConfig(ctx, ctx.plugins.pluginIdOf(p.id) ?? p.id);
  const tokens = await tokenRequest(p.auth, config, {
    grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirect_uri, code_verifier: ctx.secrets.decrypt(c.oauth_verifier_encrypted),
  });
  await exec(ctx, `UPDATE integration_connections SET credentials_encrypted = $2, oauth_state_hash = NULL, oauth_verifier_encrypted = NULL WHERE id = $1`, [c.id, ctx.secrets.encrypt(JSON.stringify(tokens))]);
  return finishConnecting(ctx, c.id, input.params);
}

/** Asks the integration who is on the other side, then marks the connection live. */
async function finishConnecting(ctx: Ctx, id: string, params: Record<string, string>) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1`, [id], 'integration_connection');
  const p = providerOrThrow(ctx, c.provider_id);
  let info: { accountName?: string; account?: Record<string, unknown> };
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  let organisations: { id: string; name: string }[];
  try {
    info = (await p.onConnected?.(ictx, params)) ?? {};
    organisations = (await p.organisations?.(ictx)) ?? [];
    // Signing in again keeps the organisation the shop chose, while the sign-in still covers it.
    const chosen = c.account?.organisation_id;
    if (chosen && p.useOrganisation && info.account?.organisation_id !== chosen && organisations.some((o) => o.id === chosen)) {
      info = { ...(await p.useOrganisation(ictx, chosen)) };
      info.account = { ...info.account, organisation_id: chosen };
    }
    await saveTokens();
  } catch (e) {
    await saveTokens();
    await exec(ctx, `UPDATE integration_connections SET status = 'pending', last_error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 1000)]);
    const reason = msg('integrations.check_failed', { name: p.name, reason: (e as Error).message.slice(0, 300) });
    // Typed credentials the other system refused: the message goes next to the first field.
    if (p.auth.type === 'fields' && p.auth.fields[0]) throw invalid(reason, [{ field: `credentials.${p.auth.fields[0].key}`, code: 'rejected', message: reason }]);
    throw new AppError('integration_check_failed', 422, reason);
  }
  await exec(
    ctx,
    `UPDATE integration_connections SET status = 'connected', account_name = $2, account = $3, sync_from = coalesce(sync_from, $4), last_error = NULL WHERE id = $1`,
    [id, info.accountName ?? null, json({ ...(info.account ?? {}), organisations }), ctx.now],
  );
  const api = await getConnection(ctx, id);
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'connect', after: api });
  await emit(ctx, 'integration.connected', { type: 'integration_connection', id }, api);
  return api;
}

export async function updateSettings(ctx: Ctx, id: string, settings: Record<string, unknown>) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1 AND status <> 'disconnected'`, [id], 'integration_connection', id);
  const p = providerOrThrow(ctx, c.provider_id);
  const known = new Set((p.settings ?? []).map((s) => s.key));
  // Bringing back payments recorded in the accounting system is OpenRent's own setting (ADR 0009).
  if (p.pullPayments) known.add('import_payments');
  const clean = Object.fromEntries(Object.entries(settings).filter(([k]) => known.has(k)));
  if ('import_payments' in clean && typeof clean.import_payments !== 'boolean') {
    throw invalid(msg('integrations.check_mapping'), [{ field: 'settings.import_payments', code: 'invalid', message: msg('settings.invalid') }]);
  }
  await exec(ctx, `UPDATE integration_connections SET settings = $2 WHERE id = $1`, [id, json({ ...c.settings, ...clean })]);
  const after = await getConnection(ctx, id);
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'update', before: c.settings, after: after.settings });
  return after;
}

/** Stops syncing and forgets the credentials; the links and the log stay for reference. */
export async function disconnect(ctx: Ctx, id: string) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1 AND status <> 'disconnected'`, [id], 'integration_connection', id);
  await exec(ctx, `UPDATE integration_connections SET status = 'disconnected', credentials_encrypted = NULL, oauth_state_hash = NULL, oauth_verifier_encrypted = NULL WHERE id = $1`, [id]);
  await exec(ctx, `UPDATE integration_tasks SET status = 'skipped', message = $2, finished_at = now() WHERE connection_id = $1 AND status IN ('pending', 'running')`, [id, msg('integrations.disconnected')]);
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'disconnect', before: connectionToApi(c) });
  await emit(ctx, 'integration.disconnected', { type: 'integration_connection', id }, { ...connectionToApi(c), status: 'disconnected' });
}

// ---------------------------------------------------------------------------
// OAuth tokens
// ---------------------------------------------------------------------------

/**
 * `{key}` in a provider's OAuth URL becomes the plugin setting `key` (a region or data centre); a test
 * base URL setting replaces the origin.
 */
export function oauthUrl(template: string, config: Record<string, unknown>, baseUrlSetting?: string) {
  const filled = template.replace(/\{([a-z0-9_]+)\}/gi, (_m, key: string) => {
    const v = String(config[key] ?? '').trim();
    if (!/^[a-z0-9.-]+$/i.test(v)) throw new AppError('integration_not_ready', 409, msg('integrations.bad_setting', { key }));
    return v;
  });
  const base = baseUrlSetting ? String(config[baseUrlSetting] ?? '').trim() : '';
  if (!/^https?:\/\/[^\s/]+/i.test(base)) return filled;
  const u = new URL(filled);
  return `${base.replace(/\/$/, '')}${u.pathname}${u.search}`;
}

type OAuth = Extract<IntegrationProvider['auth'], { type: 'oauth2' }>;

async function tokenRequest(auth: OAuth, config: Record<string, unknown>, body: Record<string, string>) {
  const clientId = String(config[auth.clientIdSetting] ?? '');
  const clientSecret = String(config[auth.clientSecretSetting] ?? '');
  const inBody = auth.clientAuth === 'body';
  const res = await fetch(oauthUrl(auth.tokenUrl, config, auth.baseUrlSetting), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
      ...(inBody ? {} : { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }),
    },
    body: new URLSearchParams(inBody ? { ...body, client_id: clientId, client_secret: clientSecret } : body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new AppError('integration_token', 502, msg('integrations.token_failed', { reason: String(data.error_description ?? data.error ?? res.status) }));
  return { access_token: data.access_token, refresh_token: data.refresh_token ?? body.refresh_token ?? null, token_type: data.token_type ?? 'Bearer', expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
}

/**
 * The context an integration works in: settings, a fetch that carries (and refreshes) the token, links,
 * data. A refreshed token is kept in memory and written by `saveTokens` after the task, even when the
 * task failed: providers retire the old refresh token as soon as they hand out a new one.
 */
export async function contextFor(ctx: Ctx, c: any, p: IntegrationProvider): Promise<{ ictx: IntegrationContext; saveTokens(): Promise<void>; refresh(): Promise<void> }> {
  const pluginId = ctx.plugins.pluginIdOf(p.id) ?? p.id;
  const { config } = await pluginConfig(ctx, pluginId);
  let creds: Record<string, any> = c.credentials_encrypted ? JSON.parse(ctx.secrets.decrypt(c.credentials_encrypted)) : {};
  let refreshed = false;
  const refresh = async () => {
    if (p.auth.type !== 'oauth2' || !creds.refresh_token) throw new AppError('integration_token', 502, msg('integrations.reconnect', { name: p.name }));
    creds = { ...(await tokenRequest(p.auth, config, { grant_type: 'refresh_token', refresh_token: creds.refresh_token })), refreshed_at: Date.now() };
    refreshed = true;
  };
  const saveTokens = async () => {
    if (refreshed) await exec(ctx, `UPDATE integration_connections SET credentials_encrypted = $2 WHERE id = $1`, [c.id, ctx.secrets.encrypt(JSON.stringify(creds))]);
    refreshed = false;
  };
  const doFetch: IntegrationContext['fetch'] = async (url, init = {}) => {
    const send = () =>
      fetch(url, {
        method: init.method ?? 'GET', body: init.body as BodyInit | undefined,
        headers: { accept: 'application/json', ...(p.auth.type === 'oauth2' ? { authorization: `${p.auth.tokenPrefix ?? 'Bearer'} ${creds.access_token}` } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      });
    if (p.auth.type === 'oauth2' && Number(creds.expires_at ?? 0) < Date.now() + 60_000) await refresh();
    let res = await send();
    // A token can be revoked before its time: refresh once and try again.
    if (res.status === 401 && p.auth.type === 'oauth2') {
      await refresh();
      res = await send();
    }
    return res;
  };
  const ictx: IntegrationContext = {
    tenantId: ctx.tenantId, config, logger: ctx.logger,
    connection: { id: c.id, settings: c.settings ?? {}, account: c.account ?? {} },
    credentials: p.auth.type === 'fields' ? creds : {},
    fetch: doFetch,
    links: {
      get: async (localType, localId) => {
        const l = await one<any>(ctx, `SELECT remote_id, extra FROM integration_links WHERE connection_id = $1 AND local_type = $2 AND local_id = $3`, [c.id, localType, localId]);
        return l ? { remoteId: l.remote_id, extra: l.extra ?? {} } : null;
      },
      set: async (localType, localId, remoteId, extra = {}) => {
        await exec(
          ctx,
          `INSERT INTO integration_links (tenant_id, connection_id, local_type, local_id, remote_id, extra) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (connection_id, local_type, local_id) DO UPDATE SET remote_id = EXCLUDED.remote_id, extra = EXCLUDED.extra, updated_at = now()`,
          [ctx.tenantId, c.id, localType, localId, remoteId, json(extra)],
        );
      },
    },
    data: {
      accounting: {
        contact: (id) => accounting.contact(ctx, id), invoice: (id) => accounting.invoice(ctx, id), payment: (id) => accounting.payment(ctx, id), entry: (id) => neutralEntry(ctx, id),
        documentPdf: (id) => accounting.documentPdf(ctx, id),
      },
      contact: (id) => accounting.contact(ctx, id),
      order: (id) => accounting.order(ctx, id),
    },
  };
  return { ictx, saveTokens, refresh };
}

/** A booked entry as integrations see it, with the customer and, for a reversal, what it undoes. */
async function neutralEntry(ctx: Ctx, id: string): Promise<AccountingEntry | null> {
  const e = await one<any>(ctx, `SELECT id FROM accounting_entries WHERE id = $1`, [id]);
  if (!e) return null;
  const x = await getEntry(ctx, id);
  const undone = x.reversal_of ? await getEntry(ctx, x.reversal_of) : null;
  return {
    id: x.id, number: x.number, kind: x.kind, date: x.entry_date, currency: x.currency, total: x.total, reference: x.reference, source: x.source as AccountingEntry['source'],
    reverses: undone ? { id: undone.id, kind: undone.kind, source: undone.source } : null,
    contact: x.customer_id ? await accounting.contact(ctx, x.customer_id) : null,
    lines: x.lines.map((l) => ({ account_key: l.account_key, debit: l.debit, credit: l.credit, tax_rate_bp: l.tax_rate_bp, description: l.description })),
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** For each live connection that wants this event, a task (the worker calls this after commit). */
export async function enqueueForEvent(ctx: Ctx, event: DomainEvent, aggregate: { type: string; id: string }) {
  const conns = await many<any>(ctx, `SELECT id, provider_id, sync_from, settings FROM integration_connections WHERE status IN ('connected', 'error')`);
  for (const c of conns) {
    const p = ctx.plugins.integration(c.provider_id);
    if (!p?.events.includes(event.type) || !syncing(c, p)) continue;
    if (c.sync_from && new Date(event.created_at) < new Date(c.sync_from)) continue;
    await exec(
      ctx,
      `INSERT INTO integration_tasks (id, tenant_id, connection_id, source_key, event, object_type, object_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (connection_id, source_key) DO NOTHING`,
      [newId('itk'), ctx.tenantId, c.id, event.id, event.type, aggregate.type, aggregate.id],
    );
  }
}

/** What a catch-up run brings across for each event, from a date on. */
const CATCH_UP: Record<string, { type: string; sql: string }> = {
  'document.issued': { type: 'document', sql: `SELECT id, issued_at AS at FROM documents WHERE type IN ('invoice', 'credit_note') AND issued_at >= $1` },
  'payment.succeeded': { type: 'payment', sql: `SELECT id, created_at AS at FROM payments WHERE status = 'succeeded' AND kind IN ('charge', 'manual') AND created_at >= $1` },
  'payment.refunded': { type: 'payment', sql: `SELECT id, created_at AS at FROM payments WHERE status = 'succeeded' AND kind = 'refund' AND created_at >= $1` },
  'customer.created': { type: 'customer', sql: `SELECT id, created_at AS at FROM customers WHERE deleted_at IS NULL AND created_at >= $1` },
  // Booked accounting entries from a date on, in booking order (ADR 0009).
  // $1 is the start day in the shop's time zone here (entries carry local dates).
  'accounting.entry_posted': { type: 'accounting_entry', sql: `SELECT id, to_timestamp(number) AS at FROM accounting_entries WHERE entry_date >= $1::date` },
  'order.created': { type: 'order', sql: `SELECT id, created_at AS at FROM orders WHERE status NOT IN ('draft', 'expired') AND created_at >= $1` },
  // Returned bookings, at the time they came back.
  'order.checked_in': {
    type: 'order',
    sql: `SELECT o.id, max(e.created_at) AS at FROM orders o JOIN order_events e ON e.order_id = o.id AND e.type = 'checked_in'
          WHERE o.status IN ('returned', 'inspected', 'closed') AND e.created_at >= $1 GROUP BY o.id`,
  },
};

/** Queues what happened since `from` (oldest first), for records not brought across yet. */
export async function catchUp(ctx: Ctx, id: string, from: string) {
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1 AND status IN ('connected', 'error')`, [id], 'integration_connection', id);
  const p = providerOrThrow(ctx, c.provider_id);
  const since = new Date(from);
  if (Number.isNaN(since.getTime())) throw invalid(msg('integrations.check_credentials'), [{ field: 'from', code: 'invalid', message: msg('error.field.invalid_date_time') }]);
  let queued = 0;
  const items: { event: string; type: string; id: string; at: Date }[] = [];
  for (const ev of p.events) {
    const q = CATCH_UP[ev];
    if (!q) continue;
    const param = ev === 'accounting.entry_posted' ? localDate(since, (await must<{ timezone: string }>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).timezone) : since;
    for (const r of await many<{ id: string; at: Date }>(ctx, q.sql, [param])) items.push({ event: ev, type: q.type, id: r.id, at: new Date(r.at) });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const [i, it] of items.entries()) {
    const n = await exec(
      ctx,
      `INSERT INTO integration_tasks (id, tenant_id, connection_id, source_key, event, object_type, object_id, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (connection_id, source_key) DO NOTHING`,
      [newId('itk'), ctx.tenantId, c.id, `sync:${it.event}:${it.id}`, it.event, it.type, it.id, new Date(ctx.now.getTime() + i)],
    );
    queued += n;
  }
  await audit(ctx, { entity_type: 'integration_connection', entity_id: id, action: 'catch_up', extra: { from, queued } });
  return { object: 'result', queued };
}

export function taskToApi(t: any) {
  return {
    id: t.id, object: 'integration_task', connection_id: t.connection_id, event: t.event, object_type: t.object_type, object_id: t.object_id, status: t.status,
    attempts: t.attempts, next_attempt_at: t.next_attempt_at, message: t.message, finished_at: t.finished_at, created_at: t.created_at,
  };
}

/** The sync log of a connection, newest first; `status` narrows it (e.g. failed). */
export async function listTasks(ctx: Ctx, connectionId: string, f: { status?: string; limit?: number } = {}) {
  return (
    await many(ctx, `SELECT * FROM integration_tasks WHERE connection_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC, id DESC LIMIT $3`, [
      connectionId, f.status ?? null, Math.min(f.limit ?? 100, 500),
    ])
  ).map(taskToApi);
}

export async function retryTask(ctx: Ctx, id: string) {
  const t = await must<any>(ctx, `SELECT * FROM integration_tasks WHERE id = $1`, [id], 'integration_task', id);
  if (!['failed', 'pending', 'skipped'].includes(t.status)) throw new AppError('task_busy', 409, msg('integrations.task_busy'));
  await exec(ctx, `UPDATE integration_tasks SET status = 'pending', attempts = 0, next_attempt_at = $2, finished_at = NULL WHERE id = $1`, [id, ctx.now]);
  return taskToApi({ ...t, status: 'pending', attempts: 0 });
}

/** Tasks due now, oldest first (the worker runs them one tenant at a time). */
export async function dueTasks(ctx: Ctx, limit = 20) {
  return many<{ id: string }>(ctx, `SELECT t.id FROM integration_tasks t JOIN integration_connections c ON c.id = t.connection_id
    WHERE t.status = 'pending' AND t.next_attempt_at <= $1 AND c.status IN ('connected', 'error') ORDER BY t.next_attempt_at, t.created_at LIMIT $2`, [ctx.now, limit]);
}

/**
 * Runs one task. Success records the result; a failure is retried later with growing waits and gives up
 * after a few days. The integration's database writes (links) are kept only when it succeeds.
 */
export async function runTask(ctx: Ctx, id: string) {
  const t = await one<any>(ctx, `SELECT * FROM integration_tasks WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED`, [id]);
  if (!t) return null;
  const c = await must<any>(ctx, `SELECT * FROM integration_connections WHERE id = $1`, [t.connection_id], 'integration_connection');
  const p = ctx.plugins.integration(c.provider_id);
  const attempt = t.attempts + 1;
  if (!p) {
    await exec(ctx, `UPDATE integration_tasks SET attempts = $2, next_attempt_at = $3, message = $4 WHERE id = $1`, [id, attempt, new Date(ctx.now.getTime() + 3600_000), msg('integrations.plugin_missing')]);
    return 'pending';
  }
  const task: IntegrationTask = { id: t.id, event: t.event, object: { type: t.object_type, id: t.object_id }, attempt };
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  await ctx.db.query('SAVEPOINT integration_task');
  try {
    const result = await Promise.race([
      p.handle(ictx, task),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg('integrations.timeout'))), TASK_TIMEOUT_MS)),
    ]);
    await ctx.db.query('RELEASE SAVEPOINT integration_task');
    await saveTokens();
    await exec(ctx, `UPDATE integration_tasks SET status = $2, attempts = $3, message = $4, finished_at = $5 WHERE id = $1`, [id, result.status, attempt, result.message ?? null, ctx.now]);
    await exec(ctx, `UPDATE integration_connections SET last_sync_at = $2, status = 'connected', last_error = NULL WHERE id = $1`, [c.id, ctx.now]);
    return result.status;
  } catch (e) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT integration_task');
    await saveTokens();
    const message = ((e as Error).message || String(e)).slice(0, 1000);
    // The other system asked to wait (429): try then, without counting it as a failure.
    const retryAfter = Number((e as { retryAfterMs?: number }).retryAfterMs);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      await exec(ctx, `UPDATE integration_tasks SET message = $2, next_attempt_at = $3 WHERE id = $1`, [id, message, new Date(ctx.now.getTime() + Math.min(retryAfter, 3600_000))]);
      return 'retry';
    }
    // The sign-in no longer works: the shop has to reconnect. Work waits, it does not fail.
    if (e instanceof AppError && e.code === 'integration_token') {
      await exec(ctx, `UPDATE integration_tasks SET message = $2, next_attempt_at = $3 WHERE id = $1`, [id, message, new Date(ctx.now.getTime() + 3600_000)]);
      await exec(ctx, `UPDATE integration_connections SET status = 'error', last_error = $2 WHERE id = $1`, [c.id, msg('integrations.reconnect', { name: p.name })]);
      return 'retry';
    }
    const giveUp = attempt >= MAX_ATTEMPTS;
    const wait = BACKOFF_MIN[Math.min(attempt - 1, BACKOFF_MIN.length - 1)]! * 60_000;
    await exec(ctx, `UPDATE integration_tasks SET status = $2, attempts = $3, message = $4, next_attempt_at = $5, finished_at = $6 WHERE id = $1`, [
      id, giveUp ? 'failed' : 'pending', attempt, message, new Date(ctx.now.getTime() + wait), giveUp ? ctx.now : null,
    ]);
    await exec(ctx, `UPDATE integration_connections SET status = 'error', last_error = $2 WHERE id = $1`, [c.id, message]);
    return giveUp ? 'failed' : 'retry';
  }
}

/** Callback URL registered with OAuth providers. */
export const callbackPath = '/api/v1/integrations/oauth/callback';
