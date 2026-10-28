import type { IdentityCheckResult } from '@openrent/plugin-sdk';
import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { enabledProvider } from '../plugins/index.ts';
import { queue, storefrontBase } from '../notifications/index.ts';

/**
 * ID checks with an outside service (FR-PAY-9): customers marked "requires ID check" verify on the
 * service's page (Stripe Identity, Veriff). The state is kept on the customer (`flags.id_check`); a
 * verified check sets `flags.id_verified`, which pickup waits for.
 */
export interface IdCheck {
  provider: string;
  ref: string;
  status: IdentityCheckResult['status'];
  url: string | null;
  reason?: string | null;
  updated_at: string;
}

/** The identity plugin this shop uses: the first that is on and set up. */
export async function activeIdentityProvider(ctx: Ctx) {
  for (const p of ctx.plugins.identityProviders?.() ?? [ctx.plugins.identityProvider()].filter((x) => !!x)) {
    const hit = await enabledProvider(ctx, p);
    if (hit) return hit;
  }
  return null;
}

/** Where an identity service reports back (plugin API 1.9): POST /webhooks/identity/{plugin}/{tenant}. */
export function identityWebhookUrl(ctx: Ctx, pluginId: string) {
  return `${ctx.config.publicUrl.replace(/\/$/, '')}/webhooks/identity/${pluginId}/${ctx.tenantId}`;
}

/** What the customer's page and account show about the check. */
export function idCheckToApi(flags: any) {
  const c = (flags?.id_check ?? null) as IdCheck | null;
  return { required: !!flags?.requires_id_check, verified: !!flags?.id_verified, status: flags?.id_verified ? 'verified' : (c?.status ?? null), url: !flags?.id_verified && c?.status === 'pending' ? c.url : null, reason: c?.reason ?? null };
}

async function save(ctx: Ctx, customerId: string, check: IdCheck, verified: boolean) {
  await exec(ctx, `UPDATE customers SET flags = coalesce(flags, '{}'::jsonb) || $2 WHERE id = $1`, [customerId, json({ id_check: check, ...(verified ? { id_verified: true } : {}) })]);
}

/**
 * Starts a check on the service's page and, with `notify`, emails the customer the link. A pending check
 * of the same service is reused rather than started twice.
 */
export async function startIdentityCheck(ctx: Ctx, customerId: string, opts: { orderId?: string | null; notify?: boolean; returnUrl?: string } = {}) {
  const c = await must<any>(ctx, `SELECT id, name, email, locale, flags FROM customers WHERE id = $1 AND deleted_at IS NULL`, [customerId], 'customer', customerId);
  if (c.flags?.id_verified) return idCheckToApi(c.flags);
  const idp = await activeIdentityProvider(ctx);
  if (!idp?.provider.start) throw new AppError('no_identity_provider', 409, msg('identity.no_provider'));
  const current = c.flags?.id_check as IdCheck | undefined;
  let check: IdCheck;
  if (current?.provider === idp.provider.id && current.status === 'pending' && current.url) check = current;
  else {
    const returnUrl = opts.returnUrl ?? `${(await storefrontBase(ctx, c.locale)).replace(/\/$/, '')}/account`;
    const s = await idp.provider.start({ ...idp.pctx, webhookUrl: identityWebhookUrl(ctx, idp.pluginId) }, { customer: { id: c.id, name: c.name, email: c.email }, orderId: opts.orderId ?? null, returnUrl, locale: c.locale });
    check = { provider: idp.provider.id, ref: s.ref, status: 'pending', url: s.url, reason: null, updated_at: ctx.now.toISOString() };
    await save(ctx, c.id, check, false);
    await audit(ctx, { entity_type: 'customer', entity_id: c.id, action: 'id_check_started', extra: { provider: check.provider, ref: check.ref } });
    await emit(ctx, 'customer.id_check_started', { type: 'customer', id: c.id }, { id: c.id, object: 'customer', id_check: idCheckToApi({ ...c.flags, id_check: check }) });
  }
  if (opts.notify !== false && c.email) {
    await queue(ctx, { template: 'id_check', to: c.email, audience: 'customer', orderId: opts.orderId ?? null, data: { customer: { name: c.name, locale: c.locale }, tenant: { name: (await one<{ name: string }>(ctx, `SELECT name FROM tenants WHERE id = $1`, [ctx.tenantId]))?.name ?? '' }, check: { url: check.url } }, dedupeKey: `id_check:${check.ref}` });
  }
  return idCheckToApi({ ...c.flags, id_check: check });
}

/** A service says how a session ended (by webhook or when asked); repeats change nothing. */
export async function applyIdentityResult(ctx: Ctx, providerId: string, r: { ref: string; status: IdentityCheckResult['status']; reason?: string | null }) {
  const c = await one<any>(ctx, `SELECT id, flags FROM customers WHERE flags->'id_check'->>'provider' = $1 AND flags->'id_check'->>'ref' = $2 FOR UPDATE`, [providerId, r.ref]);
  if (!c) return null;
  const current = c.flags.id_check as IdCheck;
  if (current.status === r.status || r.status === 'pending') return null;
  const check: IdCheck = { ...current, status: r.status, reason: r.reason ?? null, url: r.status === 'verified' ? null : current.url, updated_at: ctx.now.toISOString() };
  await save(ctx, c.id, check, r.status === 'verified');
  await audit(ctx, { entity_type: 'customer', entity_id: c.id, action: r.status === 'verified' ? 'id_verified' : 'id_check_failed', extra: { provider: providerId, ref: r.ref, reason: r.reason ?? null } });
  await emit(ctx, r.status === 'verified' ? 'customer.id_verified' : 'customer.id_check_failed', { type: 'customer', id: c.id }, { id: c.id, object: 'customer', id_check: idCheckToApi({ ...c.flags, id_check: check, ...(r.status === 'verified' ? { id_verified: true } : {}) }) });
  return r.status;
}

/** Worker: asks the service about checks still pending, for webhooks that never came. */
export async function syncIdentityChecks(ctx: Ctx) {
  const idp = await activeIdentityProvider(ctx);
  if (!idp?.provider.status) return 0;
  const open = await many<{ ref: string }>(ctx, `SELECT flags->'id_check'->>'ref' AS ref FROM customers WHERE flags->'id_check'->>'provider' = $1 AND flags->'id_check'->>'status' = 'pending' LIMIT 100`, [idp.provider.id]);
  let changed = 0;
  for (const { ref } of open) {
    try {
      const s = await idp.provider.status(idp.pctx, ref);
      if (await applyIdentityResult(ctx, idp.provider.id, { ref, status: s.status, reason: s.reason ?? null })) changed++;
    } catch (err) {
      ctx.logger.warn({ err, ref }, 'identity check status not read');
    }
  }
  return changed;
}

/**
 * Pickup of a customer who must be checked: a verified check lets it through; a pending one is asked once
 * more. Nothing is started here, because a refused pickup keeps nothing: the check starts when the booking
 * is reserved (`prepareIdentityCheck`), or staff send the link from the customer's page.
 */
export async function identityGate(ctx: Ctx, customerId: string): Promise<{ ok: true } | { ok: false; url: string | null }> {
  const c = await must<any>(ctx, `SELECT id, flags FROM customers WHERE id = $1`, [customerId], 'customer', customerId);
  if (!c.flags?.requires_id_check || c.flags.id_verified) return { ok: true };
  const idp = await activeIdentityProvider(ctx);
  const current = c.flags.id_check as IdCheck | undefined;
  if (idp?.provider.status && current?.provider === idp.provider.id && current.status === 'pending') {
    const s = await idp.provider.status(idp.pctx, current.ref).catch(() => null);
    if (s && (await applyIdentityResult(ctx, idp.provider.id, { ref: current.ref, status: s.status, reason: s.reason ?? null })) === 'verified') return { ok: true };
  }
  return { ok: false, url: current?.status === 'pending' ? current.url : null };
}

/**
 * When a booking of a customer who must be checked is reserved, the check starts and its link is emailed,
 * so they can verify before they come. It never stops the booking: a service that fails is retried by staff.
 */
export async function prepareIdentityCheck(ctx: Ctx, customerId: string | null, orderId: string) {
  if (!customerId) return;
  const c = await one<any>(ctx, `SELECT flags FROM customers WHERE id = $1`, [customerId]);
  if (!c?.flags?.requires_id_check || c.flags.id_verified) return;
  const idp = await activeIdentityProvider(ctx);
  if (!idp?.provider.start) return;
  await ctx.db.query('SAVEPOINT id_check');
  try {
    await startIdentityCheck(ctx, customerId, { orderId, notify: true });
    await ctx.db.query('RELEASE SAVEPOINT id_check');
  } catch (err) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT id_check');
    ctx.logger.warn({ err, customer: customerId }, 'ID check not started');
  }
}
