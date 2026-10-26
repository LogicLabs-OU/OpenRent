import { describe, expect, it } from 'vitest';
import type { IntegrationContext, IntegrationOrder } from '@openrent/plugin-sdk';
import { sendTime, trustpilotIntegration } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada Lovelace', company_name: null, email: 'ada@example.org', phone: null, tax_id: null, address: null };
const order: IntegrationOrder = {
  id: 'ord_1', number: 1042, status: 'returned', source: 'storefront', currency: 'EUR', total: 9300, balance: 0,
  starts_at: '2026-11-02T09:00:00.000Z', ends_at: '2026-11-05T17:00:00.000Z', created_at: '2026-10-26T10:00:00.000Z',
  contact, location: { id: 'loc_1', name: 'Tallinn' }, lines: [],
};

function fakeCtx(apiKey: string) {
  const sent: { method: string; url: string; body: any; auth: string | undefined }[] = [];
  const links = new Map<string, string>();
  const ctx: IntegrationContext = {
    tenantId: 't1', config: {}, logger: console as any,
    credentials: { api_key: apiKey, api_secret: 'secret', business_unit_id: 'bu-1' },
    connection: { id: 'icn_1', settings: { delay_days: 3, locale: 'de-DE' }, account: {} },
    fetch: async (url, init = {}) => {
      sent.push({ method: init.method ?? 'GET', url, body: init.body && url.includes('invitations') ? JSON.parse(String(init.body)) : init.body, auth: init.headers?.authorization });
      const reply = url.includes('accesstoken') ? { access_token: 'tp-token', expires_in: 3600 } : url.includes('/business-units/bu-1?') ? { displayName: 'Kayak Hire' } : {};
      return { status: url.includes('invitations') ? 202 : 200, ok: true, json: async () => reply, text: async () => '' };
    },
    links: {
      get: async (t, id) => (links.has(`${t}:${id}`) ? { remoteId: links.get(`${t}:${id}`)!, extra: {} } : null),
      set: async (t, id, remote) => void links.set(`${t}:${id}`, remote),
    },
    data: {
      accounting: { contact: async () => contact, invoice: async () => null, payment: async () => null, entry: async () => null, documentPdf: async () => null },
      contact: async () => contact,
      order: async () => order,
    },
  };
  return { ctx, sent };
}

describe('Trustpilot integration', () => {
  it('schedules the invitation days after the return, capped at 30', () => {
    expect(sendTime({ delay_days: 2 }, 0)).toBe(new Date(2 * 86_400_000).toISOString());
    expect(sendTime({ delay_days: 90 }, 0)).toBe(new Date(30 * 86_400_000).toISOString());
    expect(sendTime({}, 0)).toBe(new Date(86_400_000).toISOString());
  });

  it('checks the business unit on connect', async () => {
    const { ctx, sent } = fakeCtx('key-a');
    expect(await trustpilotIntegration().onConnected!(ctx, {})).toEqual({ accountName: 'Kayak Hire', account: { business_unit_id: 'bu-1' } });
    expect(sent[0]!.auth).toBe(`Basic ${btoa('key-a:secret')}`);
  });

  it('invites once per returned booking', async () => {
    const { ctx, sent } = fakeCtx('key-b');
    const tp = trustpilotIntegration();
    const task = { id: 't', event: 'order.checked_in', object: { type: 'order', id: 'ord_1' }, attempt: 1 };
    expect(await tp.handle(ctx, task)).toEqual({ status: 'done', message: 'Review invitation for #1042 scheduled' });
    const inv = sent.find((s) => s.url.includes('email-invitations'))!;
    expect(inv.url).toBe('https://invitations-api.trustpilot.com/v1/private/business-units/bu-1/email-invitations');
    expect(inv.auth).toBe('Bearer tp-token');
    expect(inv.body).toMatchObject({ consumerEmail: 'ada@example.org', consumerName: 'Ada Lovelace', referenceNumber: '#1042', locale: 'de-DE' });
    expect(await tp.handle(ctx, task)).toEqual({ status: 'skipped', message: '#1042 was invited already' });
  });

  it('waits for the whole booking to come back', async () => {
    const { ctx } = fakeCtx('key-c');
    order.status = 'returned_partial';
    expect(await trustpilotIntegration().handle(ctx, { id: 't', event: 'order.checked_in', object: { type: 'order', id: 'ord_1' }, attempt: 1 })).toEqual({ status: 'skipped', message: '#1042 is not fully returned yet' });
    order.status = 'returned';
  });
});
