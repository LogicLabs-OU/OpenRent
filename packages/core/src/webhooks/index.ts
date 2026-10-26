import { t as msg } from '../i18n/index.ts';
import { randomBytes } from 'node:crypto';
import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';
import { isPrivateHost, nextAttemptDelayMs, signatureHeader } from './sign.ts';

export * from './sign.ts';

export function endpointToApi(e: any) {
  return { id: e.id, object: 'webhook_endpoint', url: e.url, description: e.description, events: e.events, status: e.status, api_version: e.api_version, failing_since: e.failing_since, secret_rotated_at: e.secret_rotated_at, created_at: e.created_at, updated_at: e.updated_at };
}

function validateUrl(url: string, allowPrivate: boolean) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid(msg('error.enter_a_valid_url'), [{ field: 'url', code: 'invalid_url', message: msg('error.enter_a_valid_url') }]);
  }
  if (!allowPrivate && u.protocol !== 'https:') throw invalid(msg('error.webhook_urls_must_use_https'), [{ field: 'url', code: 'https_required', message: msg('error.field.use_an_https_url') }]);
  if (!['https:', 'http:'].includes(u.protocol)) throw invalid(msg('error.unsupported_url_scheme'));
  if (!allowPrivate && isPrivateHost(u.hostname)) throw invalid(msg('error.private_network_addresses_are_not_allowed'), [{ field: 'url', code: 'private_network', message: msg('error.field.use_a_public_host') }]);
}

export const allowPrivateNetwork = () => process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK === 'true';

export async function listEndpoints(ctx: Ctx) {
  return (await many(ctx, `SELECT * FROM webhook_endpoints ORDER BY created_at`)).map(endpointToApi);
}

export async function getEndpoint(ctx: Ctx, id: string) {
  return endpointToApi(await must(ctx, `SELECT * FROM webhook_endpoints WHERE id = $1`, [id], 'webhook_endpoint', id));
}

const newSecret = () => `whsec_${randomBytes(32).toString('base64')}`;

export async function createEndpoint(ctx: Ctx, input: { url: string; events?: string[]; description?: string; api_version?: string }) {
  validateUrl(input.url, allowPrivateNetwork());
  const secret = newSecret();
  const row = (
    await many(ctx, `INSERT INTO webhook_endpoints (id, tenant_id, url, description, events, secret_encrypted, api_version) VALUES ($1,$2,$3,$4,$5,$6,coalesce($7,'2026-10-01')) RETURNING *`, [
      newId('whe'), ctx.tenantId, input.url, input.description ?? '', input.events?.length ? input.events : ['*'], ctx.secrets.encrypt(secret), input.api_version ?? null,
    ])
  )[0];
  await audit(ctx, { entity_type: 'webhook_endpoint', entity_id: row.id, action: 'create', after: row });
  return { ...endpointToApi(row), secret };
}

export async function updateEndpoint(ctx: Ctx, id: string, patch: { url?: string; events?: string[]; description?: string; status?: 'enabled' | 'disabled_by_user' }) {
  const before = await must(ctx, `SELECT * FROM webhook_endpoints WHERE id = $1`, [id], 'webhook_endpoint', id);
  if (patch.url) validateUrl(patch.url, allowPrivateNetwork());
  const row = (
    await many(
      ctx,
      `UPDATE webhook_endpoints SET url = coalesce($2, url), events = coalesce($3, events), description = coalesce($4, description), status = coalesce($5, status),
         failing_since = CASE WHEN $5 = 'enabled' THEN NULL ELSE failing_since END WHERE id = $1 RETURNING *`,
      [id, patch.url ?? null, patch.events ?? null, patch.description ?? null, patch.status ?? null],
    )
  )[0];
  await audit(ctx, { entity_type: 'webhook_endpoint', entity_id: id, action: 'update', before, after: row });
  return endpointToApi(row);
}

export async function deleteEndpoint(ctx: Ctx, id: string) {
  const n = await exec(ctx, `DELETE FROM webhook_endpoints WHERE id = $1`, [id]);
  if (!n) throw new AppError('not_found', 404, msg('error.webhook_endpoint_not_found'));
  await audit(ctx, { entity_type: 'webhook_endpoint', entity_id: id, action: 'delete' });
}

/** Both secrets sign deliveries for 24 h after rotation (PRD §6.2). */
export async function rotateSecret(ctx: Ctx, id: string) {
  const e = await must<any>(ctx, `SELECT * FROM webhook_endpoints WHERE id = $1`, [id], 'webhook_endpoint', id);
  const secret = newSecret();
  const row = (await many(ctx, `UPDATE webhook_endpoints SET previous_secret_encrypted = secret_encrypted, secret_encrypted = $2, secret_rotated_at = now() WHERE id = $1 RETURNING *`, [id, ctx.secrets.encrypt(secret)]))[0];
  await audit(ctx, { entity_type: 'webhook_endpoint', entity_id: id, action: 'rotate_secret', extra: { had_previous: !!e.previous_secret_encrypted } });
  return { ...endpointToApi(row), secret };
}

export function matches(events: string[], type: string): boolean {
  return events.some((p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))));
}

/** Copies an outbox event into the event log and creates one delivery per matching endpoint. */
export async function fanOut(ctx: Ctx, event: { id: string; type: string; payload: unknown }): Promise<string[]> {
  await exec(ctx, `INSERT INTO webhook_events (id, tenant_id, type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [event.id, ctx.tenantId, event.type, JSON.stringify(event.payload)]);
  const endpoints = await many(ctx, `SELECT id, events FROM webhook_endpoints WHERE status = 'enabled'`);
  const ids: string[] = [];
  for (const e of endpoints) {
    if (!matches(e.events, event.type)) continue;
    const id = newId('whd');
    await exec(ctx, `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_id, next_attempt_at) VALUES ($1,$2,$3,$4,now())`, [id, ctx.tenantId, e.id, event.id]);
    ids.push(id);
  }
  return ids;
}

export async function testEndpoint(ctx: Ctx, id: string) {
  await must(ctx, `SELECT 1 FROM webhook_endpoints WHERE id = $1`, [id], 'webhook_endpoint', id);
  const evtId = newId('evt');
  const payload = { id: evtId, type: 'ping', api_version: '2026-10-01', created_at: ctx.now.toISOString(), tenant_id: ctx.tenantId, livemode: ctx.config.livemode, data: { object: { message: msg('error.field.hello_from_openrent') } }, actor: { type: ctx.actor.type, id: ctx.actor.id } };
  await exec(ctx, `INSERT INTO webhook_events (id, tenant_id, type, payload) VALUES ($1,$2,'ping',$3)`, [evtId, ctx.tenantId, JSON.stringify(payload)]);
  const dId = newId('whd');
  await exec(ctx, `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_id, next_attempt_at) VALUES ($1,$2,$3,$4,now())`, [dId, ctx.tenantId, id, evtId]);
  await emit(ctx, 'internal.webhook.deliver', { type: 'webhook_delivery', id: dId }, { delivery_id: dId });
  return { id: dId, object: 'webhook_delivery', status: 'pending', event_id: evtId };
}

export function deliveryToApi(d: any) {
  return { id: d.id, object: 'webhook_delivery', endpoint_id: d.endpoint_id, event_id: d.event_id, event_type: d.event_type, attempt: d.attempt, status: d.status, response_code: d.response_code, response_body: d.response_body, error: d.error, next_attempt_at: d.next_attempt_at, delivered_at: d.delivered_at, created_at: d.created_at };
}

export async function listDeliveries(ctx: Ctx, endpointId: string, limit = 50) {
  return (
    await many(ctx, `SELECT d.*, e.type AS event_type FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id WHERE d.endpoint_id = $1 ORDER BY d.created_at DESC LIMIT $2`, [endpointId, Math.min(limit, 200)])
  ).map(deliveryToApi);
}

export async function listEvents(ctx: Ctx, limit = 50) {
  return many(ctx, `SELECT id, type, payload, created_at FROM webhook_events ORDER BY created_at DESC LIMIT $1`, [Math.min(limit, 200)]);
}

export async function redeliver(ctx: Ctx, deliveryId: string) {
  const d = await must<any>(ctx, `SELECT * FROM webhook_deliveries WHERE id = $1`, [deliveryId], 'webhook_delivery', deliveryId);
  const id = newId('whd');
  await exec(ctx, `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_id, next_attempt_at) VALUES ($1,$2,$3,$4,now())`, [id, ctx.tenantId, d.endpoint_id, d.event_id]);
  await emit(ctx, 'internal.webhook.deliver', { type: 'webhook_delivery', id }, { delivery_id: id });
  return { id, object: 'webhook_delivery', status: 'pending', event_id: d.event_id };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

const MAX_PAYLOAD = 256 * 1024;
const FAILURE_DISABLE_MS = 3 * 24 * 3600 * 1000;

/**
 * Sends one delivery attempt. Returns when to try again (null = done).
 * At-least-once: receivers deduplicate on the event id (PRD §6.5).
 */
export async function attemptDelivery(ctx: Ctx, deliveryId: string, fetchImpl: FetchLike): Promise<{ status: string; retryAt: Date | null }> {
  const d = await one<any>(
    ctx,
    `SELECT d.*, e.payload, e.type, w.url, w.secret_encrypted, w.previous_secret_encrypted, w.secret_rotated_at, w.status AS endpoint_status, w.failing_since
       FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id JOIN webhook_endpoints w ON w.id = d.endpoint_id
      WHERE d.id = $1 FOR UPDATE OF d`,
    [deliveryId],
  );
  if (!d || d.status !== 'pending') return { status: d?.status ?? 'missing', retryAt: null };
  if (d.endpoint_status !== 'enabled' && d.type !== 'ping') {
    await exec(ctx, `UPDATE webhook_deliveries SET status = 'failed', error = 'endpoint disabled' WHERE id = $1`, [deliveryId]);
    return { status: 'failed', retryAt: null };
  }
  let body = JSON.stringify(d.payload);
  if (Buffer.byteLength(body) > MAX_PAYLOAD) {
    const p = d.payload;
    body = JSON.stringify({ ...p, data: { object: { id: p.data?.object?.id, url: `${ctx.config.publicUrl}/api/v1/${String(p.type).split('.')[0]}s/${p.data?.object?.id}` } }, truncated: true });
  }
  const secrets = [ctx.secrets.decrypt(d.secret_encrypted)];
  if (d.previous_secret_encrypted && d.secret_rotated_at && ctx.now.getTime() - new Date(d.secret_rotated_at).getTime() < 24 * 3600 * 1000) {
    secrets.push(ctx.secrets.decrypt(d.previous_secret_encrypted));
  }
  const attempt = d.attempt + 1;
  const ts = Math.floor(ctx.now.getTime() / 1000);
  let code: number | null = null;
  let respBody: string | null = null;
  let error: string | null = null;
  try {
    const res = await fetchImpl(d.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenRent-Webhooks/1.0',
        'OpenRent-Event-Id': d.payload.id,
        'OpenRent-Event-Type': d.type,
        'OpenRent-Delivery-Id': d.id,
        'OpenRent-Delivery-Attempt': String(attempt),
        'OpenRent-Signature': signatureHeader(secrets, ts, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    code = res.status;
    respBody = (await res.text()).slice(0, 2000);
  } catch (err: any) {
    error = String(err?.message ?? err).slice(0, 500);
  }
  const ok = code !== null && code >= 200 && code < 300;
  if (ok) {
    await exec(ctx, `UPDATE webhook_deliveries SET status = 'succeeded', attempt = $2, response_code = $3, response_body = $4, error = NULL, delivered_at = now(), next_attempt_at = NULL WHERE id = $1`, [deliveryId, attempt, code, respBody]);
    await exec(ctx, `UPDATE webhook_endpoints SET failing_since = NULL WHERE id = $1 AND failing_since IS NOT NULL`, [d.endpoint_id]);
    return { status: 'succeeded', retryAt: null };
  }
  const delay = nextAttemptDelayMs(attempt);
  const retryAt = delay === null ? null : new Date(ctx.now.getTime() + delay);
  await exec(ctx, `UPDATE webhook_deliveries SET status = $2, attempt = $3, response_code = $4, response_body = $5, error = $6, next_attempt_at = $7 WHERE id = $1`, [
    deliveryId, retryAt ? 'pending' : 'failed', attempt, code, respBody, error ?? (code ? `HTTP ${code}` : 'no response'), retryAt,
  ]);
  const failingSince = d.failing_since ? new Date(d.failing_since) : ctx.now;
  if (!d.failing_since) await exec(ctx, `UPDATE webhook_endpoints SET failing_since = now() WHERE id = $1`, [d.endpoint_id]);
  else if (ctx.now.getTime() - failingSince.getTime() > FAILURE_DISABLE_MS && d.type !== 'ping') {
    await exec(ctx, `UPDATE webhook_endpoints SET status = 'disabled_failures' WHERE id = $1`, [d.endpoint_id]);
    await emit(ctx, 'webhook_endpoint.disabled', { type: 'webhook_endpoint', id: d.endpoint_id }, { id: d.endpoint_id, object: 'webhook_endpoint', url: d.url, status: 'disabled_failures' });
    // Owners and admins hear about it: integrations stop receiving events until someone re-enables the endpoint.
    const { notifyStaff } = await import('../notifications/index.ts');
    await notifyStaff(ctx, null, 'staff_webhook_disabled', { url: d.url }, `webhook_disabled:${d.endpoint_id}:${failingSince.toISOString()}`);
  }
  return { status: retryAt ? 'pending' : 'failed', retryAt };
}
