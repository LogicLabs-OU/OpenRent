import type { Ctx } from '../context.ts';
import { t } from '../i18n/index.ts';
import { conflict, invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';
import { priceRules } from '../catalog/index.ts';
import { getSettings } from '../tenancy/index.ts';

/**
 * Price suggestions (FR-PR-9): once a week, each rental product's coming weeks are compared with how full
 * they are already and how full the same weeks were a year ago. Busy weeks get a suggested price rise,
 * quiet ones a cut. Nothing changes until someone accepts a suggestion, which makes an ordinary season
 * price rule; a dismissed one is not suggested again for those dates.
 */
const WEEKS_AHEAD = 12;
const WEEK_S = 7 * 86_400;

interface WeekUse {
  product_id: string;
  week: string;
  capacity: number;
  seconds: number;
}

/** Unit-seconds booked per product and week (the shop's weeks, Monday first), `shiftDays` back in time. */
async function weekUse(ctx: Ctx, tz: string, firstWeek: string, shiftDays: number) {
  return many<WeekUse>(
    ctx,
    `WITH weeks AS (
       SELECT w::date AS week, ((w::date - $3::int)::timestamp AT TIME ZONE $1) AS f, ((w::date - $3::int + 7)::timestamp AT TIME ZONE $1) AS t
         FROM generate_series($2::date, $2::date + 7 * ($4::int - 1), interval '7 days') w
     ),
     cap AS (
       SELECT v.product_id, sum(CASE v.tracking
                WHEN 'serialized' THEN (SELECT count(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status NOT IN ('retired', 'lost'))
                ELSE (SELECT coalesce(sum(sl.quantity), 0) FROM stock_levels sl WHERE sl.variant_id = v.id) END)::int AS capacity
         FROM variants v JOIN products p ON p.id = v.product_id AND p.type = 'rental' AND p.deleted_at IS NULL AND p.visibility <> 'archived'
        WHERE v.tracking IN ('serialized', 'bulk') AND v.deleted_at IS NULL
        GROUP BY 1
     ),
     used AS (
       SELECT v.product_id, weeks.week,
              sum(a.quantity * extract(epoch FROM least(coalesce(upper(a.period), weeks.t), weeks.t) - greatest(lower(a.period), weeks.f))) AS seconds
         FROM allocations a JOIN variants v ON v.id = a.variant_id JOIN weeks ON a.period && tstzrange(weeks.f, weeks.t)
        WHERE a.kind = 'reservation'
        GROUP BY 1, 2
     )
     SELECT cap.product_id, to_char(weeks.week, 'YYYY-MM-DD') AS week, cap.capacity, coalesce(used.seconds, 0)::float8 AS seconds
       FROM cap CROSS JOIN weeks LEFT JOIN used ON used.product_id = cap.product_id AND used.week = weeks.week
      WHERE cap.capacity > 0`,
    [tz, firstWeek, shiftDays, WEEKS_AHEAD],
  );
}

/** The Monday on or after `days` from now, in the shop's time zone. */
function mondayAfter(now: Date, tz: string, days: number) {
  const local = new Date(new Date(now.getTime() + days * 86_400_000).toLocaleString('en-US', { timeZone: tz }));
  const d = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const bp = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 10_000);

export function suggestionToApi(r: any) {
  return {
    id: r.id, object: 'price_suggestion', product_id: r.product_id, product_name: r.product_name ?? null, starts_on: r.starts_on, ends_on: r.ends_on,
    direction: r.adjustment_bp > 0 ? 'busy' : 'quiet', adjustment_bp: r.adjustment_bp, booked_bp: r.booked_bp, last_year_bp: r.last_year_bp, status: r.status,
    price_rule_id: r.price_rule_id, decided_at: r.decided_at, created_at: r.created_at,
  };
}

/**
 * Worker, weekly (and on request): the open suggestions are made again from the bookings as they stand.
 * Accepted and dismissed ones stay, and keep new ones off their dates.
 */
export async function computePriceSuggestions(ctx: Ctx) {
  const cfg = (await getSettings(ctx)).price_suggestions;
  // One refresh at a time per shop. Open suggestions that come out the same keep their id (someone may be
  // accepting one); the rest go.
  await exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('price_suggestions:' || $1))`, [ctx.tenantId]);
  const open = await many<{ id: string; product_id: string; starts_on: string; ends_on: string; dir: number }>(
    ctx,
    `SELECT id, product_id, starts_on::text, ends_on::text, sign(adjustment_bp)::int AS dir FROM price_suggestions WHERE status = 'open' FOR UPDATE`,
  );
  const kept = new Set<string>();
  const done = async () => {
    const stale = open.filter((o) => !kept.has(o.id)).map((o) => o.id);
    if (stale.length) await exec(ctx, `DELETE FROM price_suggestions WHERE id = ANY($1)`, [stale]);
    return kept.size;
  };
  if (!cfg.enabled) return done();
  const tz = (await one<{ timezone: string }>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId]))!.timezone;
  // From the week after next: time for a new price to matter.
  const first = mondayAfter(ctx.now, tz, 7);
  const ahead = await weekUse(ctx, tz, first, 0);
  const before = new Map((await weekUse(ctx, tz, first, 364)).map((u) => [`${u.product_id}:${u.week}`, u]));
  // Only a product booked before the weeks a year back has a past to call a week quiet by; for one that is
  // newer, or a shop that is, an empty week a year ago says nothing.
  const known = new Set(
    (await many<{ product_id: string }>(ctx, `SELECT DISTINCT v.product_id FROM allocations a JOIN variants v ON v.id = a.variant_id WHERE a.kind = 'reservation' AND lower(a.period) < $1::timestamptz - interval '364 days'`, [ctx.now])).map((r) => r.product_id),
  );
  const blocked = await many<{ product_id: string; starts_on: string; ends_on: string; dir: number }>(
    ctx,
    `SELECT product_id, starts_on::text, ends_on::text, sign(adjustment_bp)::int AS dir FROM price_suggestions WHERE status IN ('accepted', 'dismissed')`,
  );
  const rules = await many<{ product_ids: string[]; starts_on: string; ends_on: string }>(
    ctx,
    `SELECT product_ids, starts_on::text, ends_on::text FROM price_rules WHERE deleted_at IS NULL AND active AND kind IN ('season', 'holiday') AND starts_on IS NOT NULL AND ends_on IS NOT NULL`,
  );
  const overlaps = (a: { starts_on: string; ends_on: string }, s: string, e: string) => a.starts_on <= e && a.ends_on >= s;

  // Each week of each product: busy, quiet or neither.
  const byProduct = new Map<string, { week: string; dir: number; now: number; last: number | null }[]>();
  for (const u of ahead) {
    const now = u.seconds / (u.capacity * WEEK_S);
    const past = before.get(`${u.product_id}:${u.week}`);
    const last = known.has(u.product_id) && past ? past.seconds / (u.capacity * WEEK_S) : null;
    const busy = now * 10_000 >= cfg.busy_bp || (last !== null && last * 10_000 >= cfg.busy_bp);
    const quiet = last !== null && now * 10_000 < cfg.quiet_bp && last * 10_000 < cfg.quiet_bp;
    const list = byProduct.get(u.product_id) ?? [];
    list.push({ week: u.week, dir: busy ? 1 : quiet ? -1 : 0, now, last });
    byProduct.set(u.product_id, list);
  }

  for (const [product, weeks] of byProduct) {
    weeks.sort((a, b) => a.week.localeCompare(b.week));
    // Weeks in a row that lean the same way make one season.
    for (let i = 0; i < weeks.length; ) {
      const w = weeks[i]!;
      let j = i;
      while (j + 1 < weeks.length && weeks[j + 1]!.dir === w.dir && weeks[j + 1]!.week === addDays(weeks[j]!.week, 7)) j++;
      const run = weeks.slice(i, j + 1);
      i = j + 1;
      if (!w.dir) continue;
      const s = run[0]!.week;
      const e = addDays(run[run.length - 1]!.week, 6);
      if (blocked.some((b) => b.product_id === product && b.dir === w.dir && overlaps(b, s, e))) continue;
      if (rules.some((r) => (!r.product_ids.length || r.product_ids.includes(product)) && overlaps(r, s, e))) continue;
      const pick = (f: (x: (typeof run)[number]) => number) => (w.dir > 0 ? Math.max(...run.map(f)) : Math.min(...run.map(f)));
      const lasts = run.filter((x) => x.last !== null);
      const values = [w.dir * cfg.step_bp, bp(pick((x) => x.now)), lasts.length ? bp(w.dir > 0 ? Math.max(...lasts.map((x) => x.last!)) : Math.min(...lasts.map((x) => x.last!))) : null];
      const same = open.find((o) => o.product_id === product && o.starts_on === s && o.ends_on === e && o.dir === w.dir);
      if (same) {
        await exec(ctx, `UPDATE price_suggestions SET adjustment_bp = $2, booked_bp = $3, last_year_bp = $4 WHERE id = $1`, [same.id, ...values]);
        kept.add(same.id);
      } else {
        const id = newId('psg');
        await exec(ctx, `INSERT INTO price_suggestions (id, tenant_id, product_id, starts_on, ends_on, adjustment_bp, booked_bp, last_year_bp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, ctx.tenantId, product, s, e, ...values]);
        kept.add(id);
      }
    }
  }
  return done();
}

export async function listPriceSuggestions(ctx: Ctx, q: { status?: string } = {}) {
  const rows = await many(
    ctx,
    `SELECT s.*, p.name AS product_name FROM price_suggestions s JOIN products p ON p.id = s.product_id
      WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.starts_on, p.name LIMIT 500`,
    [q.status ?? null],
  );
  return rows.map(suggestionToApi);
}

async function openSuggestion(ctx: Ctx, id: string) {
  const s = await must<any>(ctx, `SELECT s.*, p.name AS product_name FROM price_suggestions s JOIN products p ON p.id = s.product_id WHERE s.id = $1 FOR UPDATE OF s`, [id], 'price_suggestion', id);
  if (s.status !== 'open') throw conflict('price_suggestion_decided', t('price_suggestion.decided'));
  return s;
}

/** Makes the season price rule; staff may change the percentage first. */
export async function acceptPriceSuggestion(ctx: Ctx, id: string, input: { adjustment_bp?: number } = {}) {
  const s = await openSuggestion(ctx, id);
  const adjustment = input.adjustment_bp ?? s.adjustment_bp;
  if (!Number.isInteger(adjustment) || adjustment === 0 || adjustment < -9000 || adjustment > 10_000)
    throw invalid(t('price_suggestion.invalid_adjustment'), [{ field: 'adjustment_bp', code: 'invalid', message: t('price_suggestion.invalid_adjustment') }]);
  const rule: any = await priceRules.create(ctx, {
    name: t(adjustment > 0 ? 'price_suggestion.rule_busy' : 'price_suggestion.rule_quiet', { product: s.product_name }).slice(0, 120),
    kind: 'season', adjustment_bp: adjustment, product_ids: [s.product_id], starts_on: s.starts_on, ends_on: s.ends_on, priority: 100, stackable: false, active: true,
  });
  const row = await one(ctx, `UPDATE price_suggestions SET status = 'accepted', price_rule_id = $2, adjustment_bp = $3, decided_at = $4, decided_by = $5 WHERE id = $1 RETURNING *`, [id, rule.id, adjustment, ctx.now, ctx.actor.id]);
  await audit(ctx, { entity_type: 'price_suggestion', entity_id: id, action: 'accept', extra: { price_rule_id: rule.id, adjustment_bp: adjustment } });
  return { ...suggestionToApi({ ...row, product_name: s.product_name }), price_rule: rule };
}

export async function dismissPriceSuggestion(ctx: Ctx, id: string) {
  const s = await openSuggestion(ctx, id);
  const row = await one(ctx, `UPDATE price_suggestions SET status = 'dismissed', decided_at = $2, decided_by = $3 WHERE id = $1 RETURNING *`, [id, ctx.now, ctx.actor.id]);
  await audit(ctx, { entity_type: 'price_suggestion', entity_id: id, action: 'dismiss' });
  return suggestionToApi({ ...row, product_name: s.product_name });
}
