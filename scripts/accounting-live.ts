/**
 * Live check of the accounting plugins against the real Xero, QuickBooks Online and Zoho Books APIs
 * (ADR 0009). Opt-in: a system is checked only when its variables are set, ideally for a sandbox or
 * demo company. For each one it refreshes the sign-in, reads the organisation's accounts and tax rates,
 * sends one DRAFT test invoice at 0 % tax and voids it again. The invoice's contact or customer
 * ("OpenRent live check …") stays behind in the test company.
 *
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REFRESH_TOKEN, XERO_TENANT_ID
 *   QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REFRESH_TOKEN, QUICKBOOKS_REALM_ID   (sandbox companies)
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID, ZOHO_DATA_CENTER (default com)
 *
 * Refresh tokens of Xero and QuickBooks change on every use: the new one is printed for the next run.
 * Get a first refresh token by connecting once from the Accounting page of a development install.
 *
 *   pnpm test:accounting-live
 */
import type { AccountingEntry, AccountingInvoice, IntegrationContext, IntegrationProvider } from '@openrent/plugin-sdk';
import { xeroIntegration } from '@openrent/plugin-accounting-xero';
import { quickbooksIntegration } from '@openrent/plugin-accounting-quickbooks';
import { zohoBooksIntegration } from '@openrent/plugin-accounting-zoho-books';

interface Live {
  name: string;
  provider: IntegrationProvider;
  env: string[];
  token: { url: string; body: boolean };
  account: Record<string, unknown>;
  config: Record<string, unknown>;
  prefix: string;
}

const env = (k: string) => process.env[k]?.trim() ?? '';
const dc = env('ZOHO_DATA_CENTER') || 'com';
const systems: Live[] = [
  {
    name: 'Xero', provider: xeroIntegration(), env: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'XERO_REFRESH_TOKEN', 'XERO_TENANT_ID'],
    token: { url: 'https://identity.xero.com/connect/token', body: false }, account: { tenant_id: env('XERO_TENANT_ID'), base_currency: null }, config: {}, prefix: 'Bearer',
  },
  {
    name: 'QuickBooks', provider: quickbooksIntegration(), env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_REFRESH_TOKEN', 'QUICKBOOKS_REALM_ID'],
    token: { url: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', body: false }, account: { realm_id: env('QUICKBOOKS_REALM_ID'), sandbox: true }, config: { environment: 'sandbox' }, prefix: 'Bearer',
  },
  {
    name: 'Zoho Books', provider: zohoBooksIntegration(), env: ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORGANIZATION_ID'],
    token: { url: `https://accounts.zoho.${dc}/oauth/v2/token`, body: true }, account: { organization_id: env('ZOHO_ORGANIZATION_ID'), data_center: dc }, config: { data_center: dc }, prefix: 'Zoho-oauthtoken',
  },
];

async function accessToken(s: Live) {
  const [id, secret, refresh] = s.env.map(env);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh!, ...(s.token.body ? { client_id: id!, client_secret: secret! } : {}) });
  const res = await fetch(s.token.url, {
    method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...(s.token.body ? {} : { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` }) },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`sign-in refresh failed: ${data.error_description ?? data.error ?? res.status}`);
  if (data.refresh_token && data.refresh_token !== refresh) console.log(`  new refresh token for the next run: ${data.refresh_token}`);
  return data.access_token as string;
}

async function check(s: Live) {
  const token = await accessToken(s);
  const links = new Map<string, { remoteId: string; extra: Record<string, unknown> }>();
  const stamp = Date.now().toString(36).toUpperCase();
  const contact = { id: 'live-contact', name: `OpenRent live check ${stamp}`, company_name: null, email: null, phone: null, tax_id: null, address: null };
  const invoice: AccountingInvoice = {
    id: 'live-doc', type: 'invoice', number: `OR-LIVE-${stamp}`, issued_at: new Date().toISOString(), due_at: null, currency: 'EUR', contact, order_number: null,
    lines: [{ description: 'OpenRent live check (voided)', quantity: 1, unit_amount: 100, net_amount: 100, tax_amount: 0, tax_rate_bp: 0, kind: 'other' }],
    net_total: 100, tax_total: 0, total: 100, credit_for: null, status: 'issued', order_payments: [],
  };
  const settings: Record<string, unknown> = { mapping: {} as Record<string, string>, invoice_status: s.name === 'Xero' ? 'DRAFT' : 'draft' };
  const ctx: IntegrationContext = {
    tenantId: 'live', config: s.config, logger: console as any, credentials: {}, connection: { id: 'live', settings, account: s.account },
    fetch: (url, init = {}) => fetch(url, { method: init.method ?? 'GET', body: init.body as BodyInit | undefined, headers: { accept: 'application/json', authorization: `${s.prefix} ${token}`, ...(init.headers ?? {}) } }),
    links: { get: async (t, id) => links.get(`${t}:${id}`) ?? null, set: async (t, id, remoteId, extra = {}) => void links.set(`${t}:${id}`, { remoteId, extra }) },
    data: {
      accounting: { contact: async () => contact, invoice: async () => invoice, payment: async () => null, entry: async () => null, documentPdf: async () => null },
      contact: async () => contact, order: async () => null,
    },
  };
  const lists = await s.provider.lookups!(ctx);
  console.log(`  ${lists.accounts?.length ?? 0} accounts, ${lists.taxRates?.length ?? 0} tax rates, ${lists.paymentAccounts?.length ?? 0} payment accounts; currencies ${lists.currencies?.join(', ') || '—'}`);
  if (lists.currencies?.length && !lists.currencies.includes('EUR')) invoice.currency = lists.currencies[0]!;
  // A throwaway mapping: the first fitting account and a 0 % tax rate.
  const mapping = settings.mapping as Record<string, string>;
  for (const slot of s.provider.mapping ?? []) {
    const pick = ((lists as any)[slot.list] ?? []).find((x: any) => !slot.types?.length || !x.type || slot.types.includes(x.type));
    if (pick) mapping[slot.key] = pick.id;
  }
  const zero = lists.taxRates?.find((t) => t.rateBp === 0);
  if (!zero) throw new Error('no 0 % tax rate to use for the check');
  mapping['taxes.0'] = zero.id;
  const entry: AccountingEntry = {
    id: 'live-entry', number: 1, kind: 'invoice', date: invoice.issued_at.slice(0, 10), currency: invoice.currency, total: 100, reference: invoice.number,
    source: { type: 'document', id: invoice.id }, reverses: null, contact, lines: [],
  };
  (ctx.data.accounting as any).entry = async (id: string) => (id === 'live-void' ? { ...entry, id: 'live-void', kind: 'invoice_void', source: { type: 'entry', id: entry.id }, reverses: { id: entry.id, kind: 'invoice', source: entry.source } } : entry);
  const sent = await s.provider.handle(ctx, { id: 'live-1', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: entry.id }, attempt: 1 });
  console.log(`  ${sent.message}; remote id ${links.get('document:live-doc')?.remoteId}`);
  if (s.name === 'Zoho Books') await ctx.fetch(`https://www.zohoapis.${dc}/books/v3/invoices/${links.get('document:live-doc')!.remoteId}/status/sent?organization_id=${s.account.organization_id}`, { method: 'POST' });
  const voided = await s.provider.handle(ctx, { id: 'live-2', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'live-void' }, attempt: 1 });
  console.log(`  ${voided.message}`);
}

let ran = 0;
let failed = 0;
for (const s of systems) {
  if (!s.env.every((k) => env(k))) {
    console.log(`${s.name}: skipped (set ${s.env.join(', ')})`);
    continue;
  }
  ran++;
  console.log(`${s.name}:`);
  try {
    await check(s);
    console.log('  ok');
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${(e as Error).message}`);
  }
}
if (!ran) console.log('Nothing to check: no credentials set.');
process.exit(failed ? 1 : 0);
