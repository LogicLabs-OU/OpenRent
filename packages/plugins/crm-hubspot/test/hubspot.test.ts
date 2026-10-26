import { describe, expect, it } from 'vitest';
import type { IntegrationContext, IntegrationOrder } from '@openrent/plugin-sdk';
import { hubspotIntegration, stageFor } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada King Lovelace', company_name: 'Analytical Ltd', email: 'ada@example.org', phone: '+372 555', tax_id: null, address: null };
const order: IntegrationOrder = {
  id: 'ord_1', number: 1042, status: 'reserved', source: 'storefront', currency: 'EUR', total: 9300, balance: 0,
  starts_at: '2026-11-02T09:00:00.000Z', ends_at: '2026-11-05T17:00:00.000Z', created_at: '2026-10-26T10:00:00.000Z',
  contact, location: { id: 'loc_1', name: 'Tallinn' }, lines: [{ description: 'Kayak', quantity: 2, total: 9300, product_id: 'prd_1' }],
};

/** A context whose fetch answers like HubSpot and records what was sent. */
function fakeCtx(found: string | null = null) {
  const sent: { method: string; path: string; body: any }[] = [];
  const links = new Map<string, string>();
  const ctx: IntegrationContext = {
    tenantId: 't1', config: {}, logger: console as any, credentials: {},
    connection: { id: 'icn_1', settings: {}, account: {} },
    fetch: async (url, init = {}) => {
      const path = url.replace('https://api.hubapi.com', '');
      sent.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const reply = path.endsWith('/search') ? { results: found ? [{ id: found }] : [] } : path.includes('/contacts') ? { id: 'hc-1' } : path.includes('/deals') ? { id: 'hd-1' } : {};
      return { status: 200, ok: true, json: async () => reply, text: async () => JSON.stringify(reply) };
    },
    links: {
      get: async (t, id) => (links.has(`${t}:${id}`) ? { remoteId: links.get(`${t}:${id}`)!, extra: {} } : null),
      set: async (t, id, remote) => void links.set(`${t}:${id}`, remote),
    },
    data: {
      accounting: { contact: async () => contact, invoice: async () => null, payment: async () => null, entry: async () => null, documentPdf: async () => null },
      contact: async () => contact,
      order: async (id) => (id === 'ord_1' ? order : null),
    },
  };
  return { ctx, sent, links };
}

describe('HubSpot integration', () => {
  it('maps order statuses to deal stages, with overrides', () => {
    expect(['quote', 'reserved', 'out', 'cancelled', 'draft'].map((s) => stageFor(s, {}))).toEqual(['contractsent', 'closedwon', 'closedwon', 'closedlost', 'appointmentscheduled']);
    expect(stageFor('reserved', { stage_booked: '1234' })).toBe('1234');
  });

  it('creates the contact and a deal tied to it, then updates the same deal', async () => {
    const { ctx, sent, links } = fakeCtx();
    const hs = hubspotIntegration();
    expect(await hs.handle(ctx, { id: 't', event: 'order.created', object: { type: 'order', id: 'ord_1' }, attempt: 1 })).toEqual({ status: 'done', message: 'Deal for #1042 created' });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /crm/v3/objects/contacts/search', 'POST /crm/v3/objects/contacts', 'POST /crm/v3/objects/deals']);
    expect(sent[1]!.body.properties).toMatchObject({ email: 'ada@example.org', firstname: 'Ada', lastname: 'King Lovelace', company: 'Analytical Ltd' });
    expect(sent[2]!.body).toMatchObject({
      properties: { dealname: '#1042 · Analytical Ltd', amount: '93', pipeline: 'default', dealstage: 'closedwon', closedate: order.starts_at },
      associations: [{ to: { id: 'hc-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
    });
    expect([...links]).toEqual([['customer:cus_1', 'hc-1'], ['order:ord_1', 'hd-1']]);

    order.status = 'cancelled';
    sent.length = 0;
    expect(await hs.handle(ctx, { id: 't2', event: 'order.status_changed', object: { type: 'order', id: 'ord_1' }, attempt: 1 })).toEqual({ status: 'done', message: 'Deal for #1042 updated' });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['PATCH /crm/v3/objects/contacts/hc-1', 'PATCH /crm/v3/objects/deals/hd-1']);
    expect(sent[1]!.body.properties.dealstage).toBe('closedlost');
    order.status = 'reserved';
  });

  it('reuses a contact HubSpot already has for the email', async () => {
    const { ctx, sent } = fakeCtx('hc-existing');
    expect(await hubspotIntegration().handle(ctx, { id: 't', event: 'customer.created', object: { type: 'customer', id: 'cus_1' }, attempt: 1 })).toEqual({ status: 'done', message: 'Contact saved' });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /crm/v3/objects/contacts/search', 'PATCH /crm/v3/objects/contacts/hc-existing']);
  });
});
