import { definePlugin, HookVeto, PluginError, type DomainEvent, type HookContext, type PluginScope } from '@openrent/plugin-sdk';
import { all, text } from './texts.ts';

/**
 * Library of Things memberships (ADR 0014): plans with a fee each month or year, a member price and a
 * limit on how many items a member has at once. Each fee is a customer invoice of its own, paid online,
 * by the saved card or at the counter; a membership is active while its fee is paid. Shops turn the plugin
 * on themselves.
 */
export const ID = 'memberships';
const P = `plg_${ID}_`;
export type Interval = 'month' | 'year';
export type Status = 'pending' | 'active' | 'lapsed' | 'cancelled';
const OPEN: Status[] = ['pending', 'active', 'lapsed'];
/** A renewal is invoiced this long before the paid period ends. */
const RENEW_AHEAD_MS = 3 * 86400_000;

export const MIGRATIONS = [
  {
    name: '0001_plans_members',
    sql: `CREATE TABLE ${P}plans (
  id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, fee bigint NOT NULL, interval text NOT NULL,
  discount_bp integer NOT NULL DEFAULT 0, max_items integer, public boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ${P}members (
  id text PRIMARY KEY, tenant_id text NOT NULL, customer_id text NOT NULL, plan_id text NOT NULL, status text NOT NULL,
  period integer NOT NULL DEFAULT 0, period_start timestamptz, period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
  invoice_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ${P}members_customer ON ${P}members (tenant_id, customer_id);
CREATE UNIQUE INDEX ${P}members_one_open ON ${P}members (tenant_id, customer_id) WHERE status <> 'cancelled'`,
  },
];

/** The end of a period that starts at `from`: a month or a year later, on the same day where it exists. */
export function addInterval(from: Date, interval: Interval): Date {
  const months = from.getUTCMonth() + (interval === 'year' ? 12 : 1);
  const year = from.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(from.getUTCDate(), last), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/** How many rental items a booking adds against the limit, and whether it goes over. */
export function overLimit(max: number | null, held: number, adding: number) {
  return max != null && held + adding > max;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

function scopeOf(ctx: HookContext): PluginScope {
  if (!ctx.scope) throw new Error('memberships: no plugin scope');
  return ctx.scope;
}

async function shop(scope: PluginScope) {
  const t = (await scope.db.query<{ locale: string; currency: string; timezone: string }>(`SELECT locale, currency, timezone FROM tenants LIMIT 1`)).rows[0];
  return { locale: t?.locale ?? 'en', currency: String(t?.currency ?? 'EUR').trim(), timezone: t?.timezone ?? 'UTC' };
}

const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
const date = (iso: string | Date, locale: string, timeZone: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(iso));

interface PlanRow {
  id: string;
  name: string;
  fee: string | number;
  interval: Interval;
  discount_bp: number;
  max_items: number | null;
  public: boolean;
}
interface MemberRow {
  id: string;
  customer_id: string;
  plan_id: string;
  status: Status;
  period: number;
  period_start: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
  invoice_id: string | null;
}

async function plan(scope: PluginScope, id: string) {
  return (await scope.db.query<PlanRow>(`SELECT * FROM ${P}plans WHERE id = $1`, [id])).rows[0] ?? null;
}

/** The customer's membership that counts now: any that is not cancelled. */
async function openMembership(scope: PluginScope, customerId: string) {
  return (await scope.db.query<MemberRow & { plan_name: string; discount_bp: number; max_items: number | null; interval: Interval; fee: string }>(
    `SELECT m.*, p.name AS plan_name, p.discount_bp, p.max_items, p.interval, p.fee FROM ${P}members m JOIN ${P}plans p ON p.id = m.plan_id
      WHERE m.customer_id = $1 AND m.status <> 'cancelled' ORDER BY m.created_at DESC LIMIT 1`,
    [customerId],
  )).rows[0] ?? null;
}

/** The plan as the admin table shows it. */
function planToApi(p: PlanRow, s: { locale: string; currency: string }) {
  const pct = p.discount_bp / 100;
  return {
    id: p.id, name: p.name, fee: { amount: Number(p.fee), currency: s.currency }, interval: p.interval, interval_label: text(p.interval === 'year' ? 'interval_year' : 'interval_month', s.locale),
    discount_pct: pct, discount_label: p.discount_bp >= 10000 ? text('benefit_free', s.locale) : `${new Intl.NumberFormat(s.locale).format(pct)} %`,
    max_items: p.max_items, public: p.public, public_label: p.public ? '✓' : '–',
  };
}

function memberToApi(m: MemberRow & { plan_name?: string }, locale: string) {
  const status = m.status === 'active' && m.cancel_at_period_end ? 'ending' : m.status;
  return {
    id: m.id, customer_id: m.customer_id, plan_id: m.plan_id, plan_name: m.plan_name ?? null, status: m.status, status_label: text(`status_${status}` as const, locale),
    period: m.period, period_end: m.period_end, cancel_at_period_end: m.cancel_at_period_end, invoice_id: m.invoice_id,
  };
}

/** Checks a plan from the admin form; money comes in minor units, the discount as a percentage. */
function checkPlan(body: any, locale: string, partial: boolean) {
  const errors: { field: string; code: string; message: string }[] = [];
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    if (!String(body.name ?? '').trim()) errors.push({ field: 'name', code: 'required', message: text('error_name', locale) });
    else out.name = String(body.name).trim().slice(0, 120);
  }
  if (!partial || body.fee !== undefined) {
    if (!Number.isInteger(body.fee) || body.fee < 0) errors.push({ field: 'fee', code: 'invalid', message: text('error_fee', locale) });
    else out.fee = body.fee;
  }
  if (!partial || body.interval !== undefined) out.interval = body.interval === 'year' ? 'year' : 'month';
  if (!partial || body.discount_pct !== undefined) {
    const pct = body.discount_pct == null ? 0 : Number(body.discount_pct);
    if (!(pct >= 0 && pct <= 100)) errors.push({ field: 'discount_pct', code: 'invalid', message: text('error_discount', locale) });
    else out.discount_bp = Math.round(pct * 100);
  }
  if (!partial || body.max_items !== undefined) {
    if (body.max_items != null && !(Number.isInteger(body.max_items) && body.max_items >= 1)) errors.push({ field: 'max_items', code: 'invalid', message: text('error_max', locale) });
    else out.max_items = body.max_items ?? null;
  }
  if (!partial || body.public !== undefined) out.public = body.public !== false;
  if (errors.length) throw new PluginError(422, 'invalid_plan', errors[0]!.message, errors);
  return out;
}

/** Invoices period `n` of a membership and asks for the money: the saved card first when `card`, else a payment link. */
async function invoicePeriod(scope: PluginScope, m: MemberRow, p: PlanRow, n: number, from: Date, opts: { card: boolean }) {
  const billing = scope.billing;
  if (!billing) throw new Error('memberships: the billing permission is missing');
  const s = await shop(scope);
  const to = addInterval(from, p.interval);
  const inv = await billing.invoiceCustomer(m.customer_id, {
    lines: [{ description: text('invoice_line', s.locale, { plan: p.name, from: date(from, s.locale, s.timezone), to: date(to, s.locale, s.timezone) }), amount: Number(p.fee) }],
    key: `${m.id}:${n}`,
    period: { from: from.toISOString(), to: to.toISOString() },
  });
  await scope.db.query(`UPDATE ${P}members SET invoice_id = $2, updated_at = now() WHERE id = $1`, [m.id, inv.id]);
  if (inv.total.amount === 0) return inv;
  const charged = opts.card ? await billing.chargeSavedCard(inv.id, `renew:${m.id}:${n}`) : 'no_card';
  if (charged !== 'paid') {
    // A shop without online payment takes the fee at the counter; the invoice is owed either way.
    await billing.requestPayment(inv.id, { notify: true }).catch(() => undefined);
  }
  return inv;
}

/** A fee was paid: the membership starts, or its next period follows the one paid before. */
export async function feePaid(scope: PluginScope, sourceKey: string, now = new Date()) {
  const m = /^memberships:([a-z0-9_]+):(\d+)$/.exec(sourceKey);
  if (!m) return;
  const member = (await scope.db.query<MemberRow & { interval: Interval }>(`SELECT m.*, p.interval FROM ${P}members m JOIN ${P}plans p ON p.id = m.plan_id WHERE m.id = $1`, [m[1]])).rows[0];
  const n = Number(m[2]);
  if (!member || member.status === 'cancelled' || n !== member.period + 1) return;
  // A renewal continues where the paid time ended; a first fee, or one paid long after, starts now.
  const start = member.period_end && new Date(member.period_end) > now ? new Date(member.period_end) : now;
  await scope.db.query(`UPDATE ${P}members SET status = 'active', period = $2, period_start = $3, period_end = $4, invoice_id = NULL, updated_at = now() WHERE id = $1`, [
    member.id, n, start.toISOString(), addInterval(start, member.interval).toISOString(),
  ]);
  await scope.events.emit(`plugin.${ID}.renewed`, { id: member.id, customer_id: member.customer_id, period: n });
}

/**
 * Hourly: invoices renewals ahead of time, pauses member prices when a fee stays unpaid past the grace
 * days, and ends memberships cancelled at the end of their period.
 */
export async function renew(scope: PluginScope, now = new Date()) {
  const config = await scope.config();
  const grace = Number.isFinite(Number(config.grace_days)) && config.grace_days !== '' ? Number(config.grace_days) : 7;
  const due = (
    await scope.db.query<MemberRow>(
      `SELECT * FROM ${P}members WHERE status IN ('active', 'lapsed') AND NOT cancel_at_period_end AND invoice_id IS NULL AND period_end <= $1`,
      [new Date(now.getTime() + RENEW_AHEAD_MS).toISOString()],
    )
  ).rows;
  for (const m of due) {
    const p = await plan(scope, m.plan_id);
    if (p) await invoicePeriod(scope, m, p, m.period + 1, new Date(m.period_end!), { card: true });
  }
  await scope.db.query(`UPDATE ${P}members SET status = 'lapsed', updated_at = now() WHERE status = 'active' AND period_end < $1`, [new Date(now.getTime() - grace * 86400_000).toISOString()]);
  await scope.db.query(`UPDATE ${P}members SET status = 'cancelled', updated_at = now() WHERE cancel_at_period_end AND status <> 'cancelled' AND period_end < $1`, [now.toISOString()]);
}

/** Items the customer has from other bookings: out now, or booked for an overlapping time. */
async function heldItems(scope: PluginScope, customerId: string, orderId: string, from: string, to: string) {
  const r = await scope.db.query<{ n: string }>(
    `SELECT coalesce(sum(l.quantity), 0)::bigint AS n FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE o.customer_id = $1 AND o.id <> $2 AND l.type = 'rental' AND l.parent_line_id IS NULL
        AND (o.status IN ('out', 'returned_partial') OR (o.status IN ('reserved', 'prepared') AND o.starts_at < $4 AND o.ends_at > $3))`,
    [customerId, orderId, from, to],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export default definePlugin({
  id: ID,
  name: 'Memberships',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['billing'],
  enabledByDefault: false,
  migrations: MIGRATIONS,
  jobs: [{ name: 'renew', cron: '5 * * * *' }],
  settings: [{ key: 'grace_days', label: 'Days a fee may stay unpaid before member prices pause', type: 'number', default: 7 }],
  locales: Object.fromEntries(Object.entries(all('setting_grace')).map(([l, v]) => [l, { 'settings.grace_days': v }])),
  setup(api) {
    // Plans: Settings → Plugins.
    api.adminPage({
      key: 'plans', title: all('plans_title'), description: all('plans_description'), placement: 'settings', path: '/plans', permission: 'pricing:read', empty: all('plans_empty'),
      columns: [
        { key: 'name', label: all('col_plan') }, { key: 'fee', label: all('col_fee'), type: 'money' }, { key: 'interval_label', label: all('col_interval') },
        { key: 'discount_label', label: all('col_discount') }, { key: 'max_items', label: all('col_max'), type: 'number' }, { key: 'public_label', label: all('col_public') },
      ],
      form: {
        create: true, update: true,
        fields: [
          { key: 'name', label: all('field_name'), type: 'text', required: true },
          { key: 'fee', label: all('field_fee'), type: 'money', required: true },
          { key: 'interval', label: all('field_interval'), type: 'select', required: true, options: [{ value: 'month', label: all('interval_month') }, { value: 'year', label: all('interval_year') }] },
          { key: 'discount_pct', label: all('field_discount'), type: 'number', min: 0, max: 100, step: 0.01, help: all('field_discount_help') },
          { key: 'max_items', label: all('field_max'), type: 'number', min: 1, step: 1, help: all('field_max_help') },
          { key: 'public', label: all('field_public'), type: 'boolean' },
        ],
      },
      remove: true,
    });
    // A customer's membership: on the customer's page.
    api.adminPage({
      key: 'members', title: all('members_title'), description: all('members_description'), placement: 'customer', path: '/members', permission: 'customers:read', empty: all('members_empty'),
      columns: [{ key: 'plan_name', label: all('col_plan') }, { key: 'status', label: all('col_status'), type: 'badge' }, { key: 'period_end', label: all('col_until'), type: 'date' }],
      form: { create: true, fields: [{ key: 'plan_id', label: all('col_plan'), type: 'select', required: true, optionsPath: '/plan_options' }] },
      actions: [
        { key: 'resend', label: all('action_resend'), when: { field: 'status', in: ['pending', 'lapsed'] } },
        { key: 'cancel', label: all('action_cancel'), confirm: all('action_cancel_confirm'), destructive: true, when: { field: 'status', in: OPEN } },
      ],
    });

    api.route({
      method: 'GET', path: '/plans', permission: 'pricing:read',
      handler: async (_req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        return { object: 'list', data: (await scope.db.query<PlanRow>(`SELECT * FROM ${P}plans ORDER BY fee, name`)).rows.map((p) => planToApi(p, s)) };
      },
    });
    api.route({
      method: 'GET', path: '/plan_options', permission: 'customers:read',
      handler: async (_req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const rows = (await scope.db.query<PlanRow>(`SELECT * FROM ${P}plans ORDER BY fee, name`)).rows;
        return { object: 'list', data: rows.map((p) => ({ value: p.id, label: text('plan_line', s.locale, { plan: p.name, fee: money(Number(p.fee), s.currency, s.locale), interval: text(p.interval === 'year' ? 'per_year' : 'per_month', s.locale) }) })) };
      },
    });
    api.route({
      method: 'POST', path: '/plans', permission: 'pricing:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const v = checkPlan(req.body ?? {}, s.locale, false);
        const row = (
          await scope.db.query<PlanRow>(`INSERT INTO ${P}plans (id, tenant_id, name, fee, interval, discount_bp, max_items, public) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
            newId('mpl'), ctx.tenantId, v.name, v.fee, v.interval, v.discount_bp, v.max_items, v.public,
          ])
        ).rows[0]!;
        return planToApi(row, s);
      },
    });
    api.route({
      method: 'PATCH', path: '/plans/:id', permission: 'pricing:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        if (!(await plan(scope, req.params.id!))) throw new PluginError(404, 'not_found', text('error_plan', s.locale));
        const v = checkPlan(req.body ?? {}, s.locale, true);
        const keys = Object.keys(v);
        if (keys.length) await scope.db.query(`UPDATE ${P}plans SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [req.params.id, ...keys.map((k) => v[k])]);
        return planToApi((await plan(scope, req.params.id!))!, s);
      },
    });
    api.route({
      method: 'DELETE', path: '/plans/:id', permission: 'pricing:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const used = (await scope.db.query(`SELECT 1 FROM ${P}members WHERE plan_id = $1 AND status <> 'cancelled' LIMIT 1`, [req.params.id])).rows.length;
        if (used) throw new PluginError(409, 'plan_in_use', text('error_plan_used', s.locale));
        await scope.db.query(`DELETE FROM ${P}plans WHERE id = $1`, [req.params.id]);
        return { id: req.params.id, deleted: true };
      },
    });

    api.route({
      method: 'GET', path: '/members', permission: 'customers:read',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const customer = typeof req.query.customer_id === 'string' ? req.query.customer_id : null;
        const rows = (
          await scope.db.query<MemberRow & { plan_name: string }>(
            `SELECT m.*, p.name AS plan_name FROM ${P}members m JOIN ${P}plans p ON p.id = m.plan_id WHERE ($1::text IS NULL OR m.customer_id = $1) ORDER BY m.created_at DESC LIMIT 200`,
            [customer],
          )
        ).rows;
        return { object: 'list', data: rows.map((m) => memberToApi(m, s.locale)) };
      },
    });
    api.route({
      method: 'POST', path: '/members', permission: 'customers:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const body = (req.body ?? {}) as { customer_id?: string; plan_id?: string };
        const p = body.plan_id ? await plan(scope, body.plan_id) : null;
        if (!p) throw new PluginError(422, 'invalid_member', text('error_plan', s.locale), [{ field: 'plan_id', code: 'required', message: text('error_plan', s.locale) }]);
        if (!body.customer_id || !(await scope.services.getCustomer(body.customer_id).catch(() => null))) throw new PluginError(404, 'not_found', 'customer not found');
        if (await openMembership(scope, body.customer_id)) throw new PluginError(409, 'already_member', text('error_member', s.locale));
        const m = (
          await scope.db.query<MemberRow>(`INSERT INTO ${P}members (id, tenant_id, customer_id, plan_id, status) VALUES ($1,$2,$3,$4,'pending') RETURNING *`, [newId('mem'), ctx.tenantId, body.customer_id, p.id])
        ).rows[0]!;
        // A free plan needs no payment: it starts now.
        const inv = await invoicePeriod(scope, m, p, 1, new Date(), { card: false });
        if (inv.total.amount === 0) await feePaid(scope, `${ID}:${m.id}:1`);
        const fresh = (await scope.db.query<MemberRow>(`SELECT * FROM ${P}members WHERE id = $1`, [m.id])).rows[0]!;
        return memberToApi({ ...fresh, plan_name: p.name }, s.locale);
      },
    });
    api.route({
      method: 'POST', path: '/members/:id/actions/resend', permission: 'customers:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const m = (await scope.db.query<MemberRow>(`SELECT * FROM ${P}members WHERE id = $1`, [req.params.id])).rows[0];
        if (!m?.invoice_id) throw new PluginError(409, 'nothing_to_pay', 'no open fee');
        return scope.billing!.requestPayment(m.invoice_id, { notify: true });
      },
    });
    api.route({
      method: 'POST', path: '/members/:id/actions/cancel', permission: 'customers:write',
      handler: async (req, ctx) => {
        const scope = scopeOf(ctx);
        const s = await shop(scope);
        const m = (await scope.db.query<MemberRow>(`SELECT * FROM ${P}members WHERE id = $1`, [req.params.id])).rows[0];
        if (!m || m.status === 'cancelled') throw new PluginError(404, 'not_found', 'membership not found');
        // Paid time is kept; an unpaid membership ends now and its fee is no longer owed.
        const paidUntil = m.period_end && new Date(m.period_end) > new Date() && m.status !== 'pending';
        if (m.invoice_id) {
          const open = await scope.billing!.invoiceDue(m.invoice_id);
          if (open.due.amount > 0 && open.status !== 'voided') await scope.billing!.voidInvoice(m.invoice_id, text('status_cancelled', s.locale));
        }
        await scope.db.query(
          paidUntil
            ? `UPDATE ${P}members SET cancel_at_period_end = true, invoice_id = NULL, updated_at = now() WHERE id = $1`
            : `UPDATE ${P}members SET status = 'cancelled', invoice_id = NULL, updated_at = now() WHERE id = $1`,
          [m.id],
        );
        const fresh = (await scope.db.query<MemberRow & { plan_name: string }>(`SELECT m.*, p.name AS plan_name FROM ${P}members m JOIN ${P}plans p ON p.id = m.plan_id WHERE m.id = $1`, [m.id])).rows[0]!;
        return memberToApi(fresh, s.locale);
      },
    });

    api.on('document.paid', async (event: DomainEvent, ctx: HookContext) => {
      const key = (event.data.object as { source_key?: string | null }).source_key;
      if (key?.startsWith(`${ID}:`)) await feePaid(scopeOf(ctx), key);
    });
    api.schedule('renew', '5 * * * *', async (ctx) => renew(scopeOf(ctx)));

    // Member prices: a rule for customers whose membership is active.
    api.priceRules({
      async rules(ctx, req) {
        if (!req.customerId) return [];
        const scope = scopeOf(ctx);
        const m = await openMembership(scope, req.customerId);
        if (!m || m.status !== 'active' || m.discount_bp <= 0) return [];
        const s = await shop(scope);
        return [{ id: m.plan_id, name: text('rule_name', s.locale, { plan: m.plan_name }), adjustment_bp: -Math.min(10000, m.discount_bp), stackable: true, priority: 50 }];
      },
    });

    // Members borrow up to their plan's number of items at a time.
    api.before('orders.transition', async (payload: { order_id: string; action: string }, ctx) => {
      if (payload.action !== 'reserve' && payload.action !== 'send_quote') return;
      const scope = scopeOf(ctx);
      const o = (await scope.db.query<{ customer_id: string | null; starts_at: string; ends_at: string }>(`SELECT customer_id, starts_at, ends_at FROM orders WHERE id = $1`, [payload.order_id])).rows[0];
      if (!o?.customer_id) return;
      const m = await openMembership(scope, o.customer_id);
      if (!m || m.max_items == null) return;
      const adding = Number((await scope.db.query<{ n: string }>(`SELECT coalesce(sum(quantity), 0)::bigint AS n FROM order_lines WHERE order_id = $1 AND type = 'rental' AND parent_line_id IS NULL`, [payload.order_id])).rows[0]?.n ?? 0);
      const held = await heldItems(scope, o.customer_id, payload.order_id, new Date(o.starts_at).toISOString(), new Date(o.ends_at).toISOString());
      if (overLimit(m.max_items, held, adding)) {
        const s = await shop(scope);
        throw new HookVeto('membership_limit', text('limit', s.locale, { plan: m.plan_name, max: m.max_items, count: held + adding }));
      }
    });

    api.storefront({
      // The member's card in their account.
      accountPanels: [
        {
          key: 'card',
          async render(ctx, customer) {
            const scope = scopeOf(ctx);
            const m = await openMembership(scope, customer.id);
            if (!m) return null;
            const s = await shop(scope);
            const l = ctx.locale;
            const plan = esc(m.plan_name);
            const until = m.period_end ? date(m.period_end, l, s.timezone) : '';
            const status =
              m.status === 'pending' ? text('panel_pending', l, { plan }) : m.status === 'lapsed' ? text('panel_lapsed', l, { plan }) : text(m.cancel_at_period_end ? 'panel_ending' : 'panel_active', l, { plan, date: until });
            const perks = [
              m.discount_bp >= 10000 ? text('benefit_free', l) : m.discount_bp > 0 ? text('benefit_discount', l, { pct: new Intl.NumberFormat(l).format(m.discount_bp / 100) }) : null,
              m.max_items != null ? text('benefit_max', l, { count: m.max_items }) : null,
            ].filter(Boolean);
            return { title: text('panel_title', l), html: `<p>${status}</p>${perks.length ? `<ul>${perks.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}` };
          },
        },
      ],
      // The plans a shop shows on a page, with how to join.
      sections: [
        {
          type: 'plans',
          name: all('section_name'),
          settings: [
            { id: 'heading', type: 'text', label: text('section_heading', 'en'), default: text('section_heading_default', 'en') },
            { id: 'text', type: 'textarea', label: text('section_text', 'en'), default: text('section_text_default', 'en') },
          ],
          async render(ctx, settings) {
            if (!ctx.scope) return '';
            const s = await shop(ctx.scope);
            const plans = (await ctx.scope.db.query<PlanRow>(`SELECT * FROM ${P}plans WHERE public ORDER BY fee, name`)).rows;
            if (!plans.length) return '';
            const l = ctx.locale;
            const items = plans.map((p) => {
              const perks = [
                p.discount_bp >= 10000 ? text('benefit_free', l) : p.discount_bp > 0 ? text('benefit_discount', l, { pct: new Intl.NumberFormat(l).format(p.discount_bp / 100) }) : null,
                p.max_items != null ? text('benefit_max', l, { count: p.max_items }) : null,
              ].filter(Boolean);
              const line = text('plan_line', l, { plan: esc(p.name), fee: money(Number(p.fee), s.currency, l), interval: text(p.interval === 'year' ? 'per_year' : 'per_month', l) });
              return `<li><strong>${line}</strong>${perks.length ? ` · ${perks.join(' ')}` : ''}</li>`;
            });
            return `<h2>${esc(String(settings.heading ?? ''))}</h2><ul>${items.join('')}</ul>${settings.text ? `<p>${esc(String(settings.text))}</p>` : ''}`;
          },
        },
      ],
    });
  },
});
