import type { AccountingContact, AccountingEntry, AccountingInvoice, AccountingPayment, DocumentPdf, IntegrationContext, IntegrationOrder } from '@openrent/plugin-sdk';
import type { FakeServer } from './common.ts';

/**
 * An IntegrationContext for calling an accounting plugin straight against a fake: real HTTP with a
 * token from the fake, links kept in memory, OpenRent's records from the fixtures a test passes.
 */
export interface MemoryData {
  contacts?: AccountingContact[];
  invoices?: AccountingInvoice[];
  payments?: AccountingPayment[];
  entries?: AccountingEntry[];
  orders?: IntegrationOrder[];
  /** Issued PDFs by document id. */
  pdfs?: Record<string, DocumentPdf>;
}

export function memoryContext(fake: FakeServer, opts: { tokenPrefix?: string; settings?: Record<string, unknown>; account?: Record<string, unknown>; config?: Record<string, unknown>; data?: MemoryData } = {}) {
  const links = new Map<string, { remoteId: string; extra: Record<string, unknown> }>();
  const data = opts.data ?? {};
  const token = fake.grant();
  const ctx: IntegrationContext = {
    tenantId: 'ten_test', config: { api_base_url: fake.url, ...(opts.config ?? {}) }, logger: { info() {}, warn() {}, error() {}, debug() {} } as any, credentials: {},
    connection: { id: 'icn_test', settings: opts.settings ?? {}, account: opts.account ?? {} },
    fetch: async (url, init = {}) => {
      const res = await fetch(url, { method: init.method ?? 'GET', body: init.body as BodyInit | undefined, headers: { accept: 'application/json', authorization: `${opts.tokenPrefix ?? 'Bearer'} ${token}`, ...(init.headers ?? {}) } });
      return res;
    },
    links: {
      get: async (t, id) => links.get(`${t}:${id}`) ?? null,
      set: async (t, id, remoteId, extra = {}) => void links.set(`${t}:${id}`, { remoteId, extra }),
    },
    data: {
      accounting: {
        contact: async (id) => data.contacts?.find((c) => c.id === id) ?? null,
        invoice: async (id) => data.invoices?.find((i) => i.id === id) ?? null,
        payment: async (id) => data.payments?.find((p) => p.id === id) ?? null,
        entry: async (id) => data.entries?.find((e) => e.id === id) ?? null,
        documentPdf: async (id) => data.pdfs?.[id] ?? null,
      },
      contact: async (id) => data.contacts?.find((c) => c.id === id) ?? null,
      order: async (id) => data.orders?.find((o) => o.id === id) ?? null,
    },
  };
  return { ctx, links, data };
}
