import type { Ctx } from '../context.ts';
import { emit } from '../events.ts';
import { invalid } from '../errors.ts';
import { t as msg, type MessageKey } from '../i18n/index.ts';
import { tenantLocale } from '../i18n/context.ts';
import { newId } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';
import { resolveSettings, type AccountKey, type TenantSettings } from '../tenancy/settings.ts';
import { addLocalDays, localDate } from '../time.ts';

/**
 * Accounting entries (FR-INT-3, ADR 0009). Database triggers queue every issued invoice and credit
 * note, every void and every payment that settles, in the same transaction that wrote it. `postPending`
 * turns the queue into balanced, numbered entries that are never changed again; a correction is a new
 * entry that reverses an earlier one. The accounting system integrations send these entries, and the
 * journal export reads them, so both always show the same books.
 */
export type EntryKind =
  | 'invoice' | 'credit_note' | 'invoice_void' | 'payment' | 'refund'
  | 'deposit_received' | 'deposit_returned' | 'deposit_applied' | 'damage_revenue';

interface DraftLine {
  key: AccountKey;
  debit: number;
  credit: number;
  taxRateBp?: number | null;
  description: string;
}

interface Draft {
  kind: EntryKind;
  sourceType: 'document' | 'payment' | 'entry';
  sourceId: string;
  at: Date;
  currency: string;
  reference: string;
  orderId: string | null;
  customerId: string | null;
  reversalOf?: string;
  lines: DraftLine[];
}

/** Which revenue account an invoice line books to, by line type. */
const REVENUE: Record<string, AccountKey> = {
  rental: 'revenue_rental', sale: 'revenue_sale', consumable: 'revenue_sale', service: 'revenue_fees', fee: 'revenue_fees',
  late_fee: 'revenue_fees', damage: 'revenue_damage', discount: 'discounts',
};

/** The account money moves through for a payment: the till, the card clearing account or the bank. */
export function moneyAccount(p: { method: string | null; provider: string | null }): AccountKey {
  if (p.method === 'deposit') return 'deposits';
  if (p.method === 'cash') return 'cash';
  if (p.method === 'card' || (p.provider && p.provider !== 'manual')) return 'card_clearing';
  return 'bank';
}

/** Debit when positive, credit when negative (and the other way round with `flip`). */
const side = (key: AccountKey, amount: number, description: string, taxRateBp?: number | null): DraftLine =>
  amount >= 0 ? { key, debit: amount, credit: 0, description, taxRateBp } : { key, debit: 0, credit: -amount, description, taxRateBp };
const flip = (l: DraftLine): DraftLine => ({ ...l, debit: l.credit, credit: l.debit });

/** An issued invoice or credit note: receivables against revenue by kind and tax by rate. */
export function documentDraft(d: any, words: (k: MessageKey) => string): Draft | null {
  const lines = (d.data?.lines ?? []) as any[];
  const revenue = new Map<AccountKey, number>();
  const tax = new Map<number, number>();
  let total = 0;
  for (const l of lines) {
    const gross = Math.round(Number(l.total ?? 0));
    const t = Math.round(Number(l.tax ?? 0));
    total += gross;
    const key = REVENUE[l.type] ?? 'revenue_other';
    revenue.set(key, (revenue.get(key) ?? 0) + gross - t);
    if (t) tax.set(Number(l.tax_rate_bp ?? 0), (tax.get(Number(l.tax_rate_bp ?? 0)) ?? 0) + t);
  }
  if (!total && !revenue.size) return null;
  const what = d.type === 'credit_note' ? words('journal.credit_note') : words('journal.invoice');
  // An invoice debits receivables and credits revenue and tax; a credit note is its mirror.
  let out: DraftLine[] = [side('receivable', total, what)];
  for (const [key, amount] of revenue) if (amount) out.push(flip(side(key, amount, key === 'discounts' ? words('journal.discount') : what)));
  for (const [rate, amount] of tax) out.push(flip(side('tax', amount, words('journal.tax'), rate)));
  if (d.type === 'credit_note') out = out.map(flip);
  return {
    kind: d.type === 'credit_note' ? 'credit_note' : 'invoice', sourceType: 'document', sourceId: d.id, at: new Date(d.issued_at ?? d.created_at),
    currency: String(d.currency).trim(), reference: d.number, orderId: d.order_id ?? null, customerId: d.customer_id ?? null, lines: out,
  };
}

/**
 * A payment that settled. Money comes in to (or goes out of) the till, card clearing or bank account;
 * the other side is the customer's receivable, the deposits held, or damage revenue when a deposit
 * kept for damage was never invoiced.
 */
export function paymentDraft(p: any, o: { number: number | null; customer_id: string | null; damageInvoiced: boolean }, words: (k: MessageKey) => string): Draft | null {
  const amount = Math.abs(Math.round(Number(p.amount)));
  if (!amount) return null;
  const money = moneyAccount(p);
  const refund = p.kind === 'refund';
  // The deposit side of moving a kept deposit to damage: deposits to deposits, nothing to book.
  if (refund && p.purpose === 'deposit' && p.method === 'deposit') return null;
  let kind: EntryKind;
  let other: AccountKey;
  let what: string;
  if (p.purpose === 'deposit') {
    kind = refund ? 'deposit_returned' : 'deposit_received';
    other = 'deposits';
    what = refund ? words('journal.deposit_returned') : words('journal.deposit');
  } else if (p.purpose === 'damage' && !o.damageInvoiced && !refund) {
    kind = p.method === 'deposit' ? 'deposit_applied' : 'damage_revenue';
    other = 'revenue_damage';
    what = words('journal.damage');
  } else {
    kind = refund ? 'refund' : p.method === 'deposit' ? 'deposit_applied' : 'payment';
    other = 'receivable';
    what = refund ? words('journal.refund') : words('journal.payment');
  }
  const desc = p.method && p.method !== 'deposit' ? `${what} (${p.method})` : what;
  const lines: DraftLine[] = refund
    ? [{ key: other, debit: amount, credit: 0, description: desc }, { key: money, debit: 0, credit: amount, description: desc }]
    : [{ key: money, debit: amount, credit: 0, description: desc }, { key: other, debit: 0, credit: amount, description: desc }];
  return {
    kind, sourceType: 'payment', sourceId: p.id, at: new Date(p.created_at), currency: String(p.currency).trim(),
    reference: o.number ? `#${o.number}` : p.id, orderId: p.order_id ?? null, customerId: o.customer_id, lines,
  };
}

/** The entry that undoes `e`: the same lines with debit and credit swapped. */
async function reversalDraft(ctx: Ctx, e: any, kind: EntryKind, at: Date, words: (k: MessageKey) => string): Promise<Draft> {
  const lines = await many<any>(ctx, `SELECT * FROM accounting_entry_lines WHERE entry_id = $1 ORDER BY position`, [e.id]);
  return {
    kind, sourceType: 'entry', sourceId: e.id, at, currency: String(e.currency).trim(), reference: e.reference, orderId: e.order_id, customerId: e.customer_id, reversalOf: e.id,
    lines: lines.map((l) => ({ key: l.account_key, debit: Number(l.credit), credit: Number(l.debit), taxRateBp: l.tax_rate_bp, description: `${words('journal.reversal')}: ${l.description}` })),
  };
}

async function draftsFor(ctx: Ctx, q: { source_type: string; source_id: string; event: string }, words: (k: MessageKey) => string): Promise<Draft[]> {
  if (q.source_type === 'document') {
    const d = await one<any>(ctx, `SELECT * FROM documents WHERE id = $1`, [q.source_id]);
    if (!d) return [];
    if (q.event === 'issued') {
      const draft = documentDraft(d, words);
      return draft ? [draft] : [];
    }
    // A voided invoice is undone by its credit note; anything voided without one is reversed here.
    if (d.voided_by_id) return [];
    const e = await one<any>(ctx, `SELECT * FROM accounting_entries WHERE source_type = 'document' AND source_id = $1 AND kind IN ('invoice', 'credit_note')`, [d.id]);
    return e ? [await reversalDraft(ctx, e, 'invoice_void', ctx.now, words)] : [];
  }
  const p = await one<any>(ctx, `SELECT * FROM payments WHERE id = $1`, [q.source_id]);
  if (!p) return [];
  if (q.event === 'reversed') {
    const e = await one<any>(ctx, `SELECT * FROM accounting_entries WHERE source_type = 'payment' AND source_id = $1`, [p.id]);
    return e ? [await reversalDraft(ctx, e, e.kind, ctx.now, words)] : [];
  }
  const o = p.order_id
    ? await one<any>(
        ctx,
        `SELECT o.number, o.customer_id, EXISTS (SELECT 1 FROM damage_charges dc WHERE dc.order_id = o.id AND dc.status = 'invoiced') AS damage_invoiced FROM orders o WHERE o.id = $1`,
        [p.order_id],
      )
    : null;
  const draft = paymentDraft(p, { number: o?.number ?? null, customer_id: o?.customer_id ?? null, damageInvoiced: !!o?.damage_invoiced }, words);
  return draft ? [draft] : [];
}

/** Writes one entry, unless that movement is already booked. Dates on or before the lock date move to the day after. */
async function insertEntry(ctx: Ctx, d: Draft, s: TenantSettings, tz: string) {
  if (await one(ctx, `SELECT 1 FROM accounting_entries WHERE kind = $1 AND source_type = $2 AND source_id = $3`, [d.kind, d.sourceType, d.sourceId])) return null;
  const lines = d.lines.filter((l) => l.debit || l.credit);
  const debit = lines.reduce((n, l) => n + l.debit, 0);
  const credit = lines.reduce((n, l) => n + l.credit, 0);
  if (!lines.length || debit !== credit) {
    ctx.logger.error({ draft: d }, 'accounting entry does not balance; not posted');
    return null;
  }
  const day = localDate(d.at, tz);
  const lock = s.accounting.locked_until;
  const entryDate = lock && day <= lock ? addLocalDays(lock, 1) : day;
  const number = (await one<{ n: number }>(ctx, `SELECT coalesce(max(number), 0)::int + 1 AS n FROM accounting_entries`))!.n;
  const id = newId('ace');
  await exec(
    ctx,
    `INSERT INTO accounting_entries (id, tenant_id, number, kind, source_type, source_id, entry_date, original_date, currency, total, reference, order_id, customer_id, reversal_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, ctx.tenantId, number, d.kind, d.sourceType, d.sourceId, entryDate, entryDate === day ? null : day, d.currency, debit, d.reference, d.orderId, d.customerId, d.reversalOf ?? null],
  );
  for (const [i, l] of lines.entries()) {
    await exec(
      ctx,
      `INSERT INTO accounting_entry_lines (id, tenant_id, entry_id, position, account_key, account_code, debit, credit, tax_rate_bp, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId('acl'), ctx.tenantId, id, i + 1, l.key, s.accounting.accounts[l.key], l.debit, l.credit, l.taxRateBp ?? null, l.description],
    );
  }
  const entry = await getEntry(ctx, id);
  await emit(ctx, 'accounting.entry_posted', { type: 'accounting_entry', id }, entry);
  return entry;
}

/**
 * Books what the triggers queued, oldest first, inside the caller's transaction. One poster per shop
 * at a time (the advisory lock), so numbers stay gap-free. Returns how many queue items were handled.
 */
export async function postPending(ctx: Ctx, limit = 500): Promise<number> {
  await exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, [`${ctx.tenantId}|accounting`]);
  const queue = await many<any>(ctx, `SELECT * FROM accounting_queue ORDER BY created_at, id LIMIT $1`, [limit]);
  if (!queue.length) return 0;
  const t = await must<any>(ctx, `SELECT settings, timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings);
  const locale = await tenantLocale(ctx);
  const words = (k: MessageKey) => msg(k, {}, locale);
  for (const q of queue) {
    for (const draft of await draftsFor(ctx, q, words)) await insertEntry(ctx, draft, s, t.timezone);
    await exec(ctx, `DELETE FROM accounting_queue WHERE id = $1`, [q.id]);
  }
  return queue.length;
}

/**
 * Queues every movement from before the triggers existed that has no entry yet, at the time it
 * happened, so history is booked in order. Safe to run again: booked movements are left alone.
 */
export async function backfill(ctx: Ctx): Promise<number> {
  const id = `'acq_' || replace(gen_random_uuid()::text, '-', '')`;
  const docs = await many(
    ctx,
    `INSERT INTO accounting_queue (id, tenant_id, source_type, source_id, event, created_at)
     SELECT ${id}, d.tenant_id, 'document', d.id, 'issued', coalesce(d.issued_at, d.created_at) FROM documents d
      WHERE d.type IN ('invoice', 'credit_note') AND d.issued_at IS NOT NULL AND d.status <> 'draft'
        AND NOT EXISTS (SELECT 1 FROM accounting_entries e WHERE e.source_type = 'document' AND e.source_id = d.id)
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  const pays = await many(
    ctx,
    `INSERT INTO accounting_queue (id, tenant_id, source_type, source_id, event, created_at)
     SELECT ${id}, p.tenant_id, 'payment', p.id, 'succeeded', p.created_at FROM payments p
      WHERE p.status = 'succeeded' AND p.kind <> 'authorization'
        AND NOT EXISTS (SELECT 1 FROM accounting_entries e WHERE e.source_type = 'payment' AND e.source_id = p.id)
        AND NOT (p.kind = 'refund' AND p.purpose = 'deposit' AND p.method = 'deposit')
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  return docs.length + pays.length;
}

export async function getEntry(ctx: Ctx, id: string) {
  const e = await must<any>(ctx, `SELECT * FROM accounting_entries WHERE id = $1`, [id], 'accounting_entry', id);
  const lines = await many<any>(ctx, `SELECT * FROM accounting_entry_lines WHERE entry_id = $1 ORDER BY position`, [id]);
  return entryToApi(e, lines);
}

export function entryToApi(e: any, lines: any[]) {
  return {
    id: e.id, object: 'accounting_entry', number: e.number, kind: e.kind, source: { type: e.source_type, id: e.source_id }, entry_date: dateString(e.entry_date),
    original_date: e.original_date ? dateString(e.original_date) : null, currency: String(e.currency).trim(), total: Number(e.total), reference: e.reference,
    order_id: e.order_id, customer_id: e.customer_id, reversal_of: e.reversal_of, created_at: e.created_at,
    lines: lines.map((l) => ({
      account_key: l.account_key, account_code: l.account_code, debit: Number(l.debit), credit: Number(l.credit), tax_rate_bp: l.tax_rate_bp, description: l.description,
    })),
  };
}

/** `date` columns come back as Date at midnight UTC or as a string, depending on the driver. */
const dateString = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export interface JournalRow {
  date: string;
  number: number;
  entry: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
  currency: string;
}

/** The booked entries between two moments, line by line, for the CSV/XLSX journal export. */
export async function journal(ctx: Ctx, q: { from: string; to: string }): Promise<JournalRow[]> {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw invalid(msg('error.from_and_to_must_be_iso_dates'), [{ field: 'to', code: 'invalid_range', message: msg('error.from_and_to_must_be_iso_dates') }]);
  await postPending(ctx);
  const tz = (await must<any>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).timezone;
  const rows = await many<any>(
    ctx,
    `SELECT e.entry_date, e.number, e.reference, e.currency, l.account_code, l.description, l.debit, l.credit
       FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
      WHERE e.entry_date >= $1 AND e.entry_date < $2 ORDER BY e.number, l.position`,
    [localDate(from, tz), localDate(to, tz)],
  );
  return rows.map((r) => ({
    date: dateString(r.entry_date), number: r.number, entry: r.reference, account: r.account_code, description: r.description,
    debit: Number(r.debit), credit: Number(r.credit), currency: String(r.currency).trim(),
  }));
}
