import type { DomainEvent } from '@openrent/plugin-sdk';
import type { Ctx } from './context.ts';
import { newId } from './ids.ts';
import { exec, json } from './sql.ts';

export const API_VERSION = '2026-10-01';

/**
 * Writes an event to the transactional outbox. It is published (webhooks, plugins,
 * internal jobs) if and only if the surrounding transaction commits (PRD §6).
 * Types starting with `internal.` drive jobs and are never sent to webhook endpoints.
 */
export async function emit(
  ctx: Ctx,
  type: string,
  aggregate: { type: string; id: string },
  object: unknown,
  previous?: Record<string, unknown>,
): Promise<string> {
  const id = newId('evt');
  const event: DomainEvent = {
    id,
    type,
    api_version: API_VERSION,
    created_at: ctx.now.toISOString(),
    tenant_id: ctx.tenantId,
    livemode: ctx.config.livemode,
    data: previous ? { object, previous_attributes: previous } : { object },
    request: { id: ctx.requestId ?? null, idempotency_key: ctx.idempotencyKey ?? null },
    actor: { type: ctx.actor.type, id: ctx.actor.id },
  };
  await exec(
    ctx,
    `INSERT INTO outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, ctx.tenantId, aggregate.type, aggregate.id, type, json(event)],
  );
  await exec(ctx, `SELECT pg_notify('openrent_outbox', $1)`, [ctx.tenantId]);
  return id;
}

/** Shallow diff of two records: { field: [before, after] }. */
export function diff(before: Record<string, any> | null, after: Record<string, any> | null): Record<string, unknown> {
  if (!before) return { created: after };
  if (!after) return { deleted: before };
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'updated_at' || k === 'version') continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}

const REDACT = new Set(['password_hash', 'totp_secret', 'totp_pending', 'key_hash', 'token_hash', 'secret_encrypted', 'previous_secret_encrypted', 'config_encrypted']);

function redact(o: Record<string, any> | null): Record<string, any> | null {
  if (!o) return o;
  const r: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) r[k] = REDACT.has(k) ? '[redacted]' : v;
  return r;
}

/** Appends to the audit log in the same transaction as the change (FR-AUD-1). */
export async function audit(
  ctx: Ctx,
  entry: { entity_type: string; entity_id: string; action: string; before?: Record<string, any> | null; after?: Record<string, any> | null; extra?: Record<string, unknown> },
): Promise<void> {
  const d = { ...diff(redact(entry.before ?? null), redact(entry.after ?? null)), ...(entry.extra ?? {}) };
  await exec(
    ctx,
    `INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, entity_type, entity_id, action, diff, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [newId('aud'), ctx.tenantId, ctx.actor.type, ctx.actor.id, entry.entity_type, entry.entity_id, entry.action, json(d), ctx.ip ?? null, ctx.requestId ?? null],
  );
}
