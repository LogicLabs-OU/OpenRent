import { resolveCname, resolveTxt } from 'node:dns/promises';
import type { Ctx } from '../context.ts';
import { invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, randomToken } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, one } from '../sql.ts';

/**
 * Custom storefront domains (FR-SF-1). A shop adds `shop.example.com`, publishes either a TXT record
 * `_openrent.shop.example.com = openrent-verify=<token>` or a CNAME to the installation's host, and the
 * worker (or "Check now") marks the domain verified. Only verified domains serve the storefront.
 */
export interface DomainRow {
  id: string;
  tenant_id: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  verification_token: string;
  is_primary: boolean;
  verified_at: Date | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

/** DNS lookups, replaceable in tests. */
export interface Resolver {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
}
export const systemResolver: Resolver = {
  txt: async (name) => (await resolveTxt(name)).map((parts) => parts.join('')),
  cname: (name) => resolveCname(name),
};

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Pending domains are checked for this long after they were added, then marked failed. */
export const PENDING_DAYS = 7;

/** The host a CNAME should point to: the installation's storefront host. */
export function cnameTarget(ctx: Ctx) {
  return new URL(ctx.config.storefrontUrl).hostname;
}

export function domainToApi(ctx: Ctx, d: DomainRow) {
  return {
    id: d.id,
    object: 'storefront_domain',
    hostname: d.hostname,
    status: d.status,
    is_primary: d.is_primary,
    verified_at: d.verified_at,
    last_checked_at: d.last_checked_at,
    last_error: d.last_error,
    dns: {
      txt: { name: `_openrent.${d.hostname}`, value: `openrent-verify=${d.verification_token}` },
      cname: { name: d.hostname, target: cnameTarget(ctx) },
    },
    created_at: d.created_at,
  };
}

export function normalizeHostname(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').replace(/\.$/, '');
}

export async function listDomains(ctx: Ctx) {
  return (await many<DomainRow>(ctx, `SELECT * FROM storefront_domains ORDER BY is_primary DESC, created_at`)).map((d) => domainToApi(ctx, d));
}

export async function addDomain(ctx: Ctx, input: { hostname: string }) {
  const hostname = normalizeHostname(input.hostname ?? '');
  const platform = cnameTarget(ctx);
  if (!HOST.test(hostname) || hostname.length > 253) throw invalid(msg('domains.invalid'), [{ field: 'hostname', code: 'invalid', message: msg('domains.invalid') }]);
  if (hostname === platform || hostname.endsWith(`.${platform}`)) throw invalid(msg('domains.platform'), [{ field: 'hostname', code: 'reserved', message: msg('domains.platform') }]);
  // Hostnames are unique across shops; RLS hides other shops' rows, so ask the unique index.
  try {
    await ctx.db.query('SAVEPOINT add_domain');
    const row = (
      await many<DomainRow>(ctx, `INSERT INTO storefront_domains (id, tenant_id, hostname, verification_token, is_primary) VALUES ($1,$2,$3,$4, NOT EXISTS (SELECT 1 FROM storefront_domains)) RETURNING *`, [
        newId('dom'), ctx.tenantId, hostname, randomToken(16),
      ])
    )[0]!;
    await ctx.db.query('RELEASE SAVEPOINT add_domain');
    await audit(ctx, { entity_type: 'storefront_domain', entity_id: row.id, action: 'create', after: row });
    return domainToApi(ctx, row);
  } catch (err: any) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT add_domain');
    if (err?.code === '23505' || err?.cause?.code === '23505') throw invalid(msg('domains.taken'), [{ field: 'hostname', code: 'taken', message: msg('domains.taken') }]);
    throw err;
  }
}

async function getRow(ctx: Ctx, id: string) {
  const d = await one<DomainRow>(ctx, `SELECT * FROM storefront_domains WHERE id = $1`, [id]);
  if (!d) throw notFound('storefront_domain', id);
  return d;
}

export async function removeDomain(ctx: Ctx, id: string) {
  const d = await getRow(ctx, id);
  await exec(ctx, `DELETE FROM storefront_domains WHERE id = $1`, [id]);
  // Another verified domain becomes primary.
  if (d.is_primary) await exec(ctx, `UPDATE storefront_domains SET is_primary = true WHERE id = (SELECT id FROM storefront_domains ORDER BY status = 'verified' DESC, created_at LIMIT 1)`);
  await audit(ctx, { entity_type: 'storefront_domain', entity_id: id, action: 'delete', before: d });
  return { id, object: 'storefront_domain', deleted: true };
}

export async function makePrimary(ctx: Ctx, id: string) {
  await getRow(ctx, id);
  await exec(ctx, `UPDATE storefront_domains SET is_primary = false WHERE is_primary AND id <> $1`, [id]);
  await exec(ctx, `UPDATE storefront_domains SET is_primary = true WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'storefront_domain', entity_id: id, action: 'update', extra: { is_primary: true } });
  return domainToApi(ctx, await getRow(ctx, id));
}

/** Looks up the DNS records and records the outcome; a domain stays verified if a later check fails once. */
export async function verifyDomain(ctx: Ctx, id: string, resolver: Resolver = systemResolver) {
  const d = await getRow(ctx, id);
  const target = cnameTarget(ctx);
  let ok = false;
  let error: string | null = null;
  try {
    const txt = await resolver.txt(`_openrent.${d.hostname}`).catch(() => [] as string[]);
    ok = txt.some((v) => v.trim() === `openrent-verify=${d.verification_token}`);
    if (!ok) {
      const cname = await resolver.cname(d.hostname).catch(() => [] as string[]);
      ok = cname.some((c) => c.replace(/\.$/, '').toLowerCase() === target);
    }
    if (!ok) error = msg('domains.not_found_in_dns', { name: `_openrent.${d.hostname}`, target });
  } catch (err) {
    error = String((err as Error)?.message ?? err);
  }
  const expired = !ok && d.status === 'pending' && ctx.now.getTime() - new Date(d.created_at).getTime() > PENDING_DAYS * 86_400_000;
  const status = ok ? 'verified' : d.status === 'verified' ? 'verified' : expired ? 'failed' : d.status;
  await exec(ctx, `UPDATE storefront_domains SET status = $2, last_checked_at = now(), last_error = $3, verified_at = CASE WHEN $4 AND verified_at IS NULL THEN now() ELSE verified_at END WHERE id = $1`, [id, status, ok ? null : error, ok]);
  if (ok && d.status !== 'verified') await emit(ctx, 'storefront_domain.verified', { type: 'storefront_domain', id }, { id, object: 'storefront_domain', hostname: d.hostname });
  return domainToApi(ctx, await getRow(ctx, id));
}

/** Worker: checks domains still waiting (and failed ones a member asked to recheck). */
export async function verifyPending(ctx: Ctx, resolver: Resolver = systemResolver) {
  const rows = await many<{ id: string }>(ctx, `SELECT id FROM storefront_domains WHERE status = 'pending' ORDER BY last_checked_at NULLS FIRST LIMIT 50`);
  for (const r of rows) await verifyDomain(ctx, r.id, resolver);
  return rows.length;
}

/** The tenant behind a verified hostname (system access; the hostname is global). */
export async function tenantByHost(db: Ctx['db'], hostname: string): Promise<string | null> {
  const r = await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM storefront_domains WHERE hostname = $1 AND status = 'verified'`, [normalizeHostname(hostname)]);
  return r.rows[0]?.tenant_id ?? null;
}

/**
 * Base URL for links to the shop's storefront: the primary verified domain; else, on a multi-shop
 * installation with shop subdomains, `{slug}.` that domain; else the installation's.
 */
export async function storefrontBase(ctx: Ctx): Promise<string> {
  const d = await one<{ hostname: string }>(ctx, `SELECT hostname FROM storefront_domains WHERE status = 'verified' ORDER BY is_primary DESC, verified_at LIMIT 1`);
  if (d) return `https://${d.hostname}`;
  const own = ctx.config.storefrontUrl.replace(/\/$/, '');
  const wildcard = ctx.config.multiTenant ? ctx.config.storefrontDomain?.replace(/^\*\./, '') : null;
  if (!wildcard) return own;
  const t = await one<{ slug: string }>(ctx, `SELECT slug FROM tenants WHERE id = $1`, [ctx.tenantId]);
  return t ? `${new URL(own).protocol}//${t.slug}.${wildcard}` : own;
}
