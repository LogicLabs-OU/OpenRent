import { definePlugin, type IntegrationContext, type IntegrationOrder, type IntegrationProvider } from '@openrent/plugin-sdk';

/**
 * HubSpot CRM: customers become contacts and bookings become deals on the shop's pipeline, moving
 * stage as the booking does (quote, booked, cancelled). Records are found again through the remote-id
 * map, or by email for contacts made before connecting.
 */
const AUTHORIZE = 'https://app.hubspot.com/oauth/authorize';
const TOKEN = 'https://api.hubapi.com/oauth/v1/token';
const API = 'https://api.hubapi.com';
/** HubSpot's own association type for deal → contact. */
const DEAL_TO_CONTACT = 3;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Minor units to the currency's decimal amount (2 digits, or 0 for currencies like JPY). */
export const major = (n: number, currency: string) => {
  const d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return Number((n / 10 ** d).toFixed(d));
};

/** The deal stage for an order status, from the connection's settings or HubSpot's default pipeline. */
export function stageFor(status: string, settings: Record<string, unknown>) {
  if (status === 'quote') return str(settings.stage_quote) ?? 'contractsent';
  if (['cancelled', 'expired'].includes(status)) return str(settings.stage_lost) ?? 'closedlost';
  if (status === 'draft') return str(settings.stage_draft) ?? 'appointmentscheduled';
  return str(settings.stage_booked) ?? 'closedwon';
}

async function call(ctx: IntegrationContext, method: string, path: string, body?: unknown) {
  const res = await ctx.fetch(`${str(ctx.config.api_base_url) ?? API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HubSpot: ${data?.message ?? `HTTP ${res.status}`}`);
  return data;
}

function contactProperties(c: NonNullable<IntegrationOrder['contact']>) {
  const [first, ...rest] = c.name.trim().split(/\s+/);
  return {
    email: c.email ?? undefined, firstname: first || undefined, lastname: rest.join(' ') || undefined, phone: c.phone ?? undefined, company: c.company_name ?? undefined,
    address: c.address?.line1, city: c.address?.city, zip: c.address?.postal_code, country: c.address?.country,
  };
}

/** Creates or updates the contact for an OpenRent customer; null when it has no email to match on. */
async function upsertContact(ctx: IntegrationContext, customerId: string) {
  const c = await ctx.data.contact(customerId);
  if (!c) return null;
  const properties = contactProperties(c);
  const known = await ctx.links.get('customer', customerId);
  if (known) {
    await call(ctx, 'PATCH', `/crm/v3/objects/contacts/${known.remoteId}`, { properties });
    return known.remoteId;
  }
  if (!c.email) return null;
  const found = await call(ctx, 'POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: c.email }] }], properties: ['email'], limit: 1,
  });
  let id: string | undefined = found?.results?.[0]?.id;
  if (id) await call(ctx, 'PATCH', `/crm/v3/objects/contacts/${id}`, { properties });
  else id = (await call(ctx, 'POST', '/crm/v3/objects/contacts', { properties }))?.id;
  if (!id) throw new Error('HubSpot did not return a contact');
  await ctx.links.set('customer', customerId, id);
  return id;
}

async function upsertDeal(ctx: IntegrationContext, orderId: string) {
  const o = await ctx.data.order(orderId);
  if (!o) return { status: 'skipped' as const, message: 'Order not found' };
  if (o.status === 'draft' && !ctx.connection.settings.include_drafts) return { status: 'skipped' as const, message: `Draft #${o.number} not sent` };
  const contactId = o.contact ? await upsertContact(ctx, o.contact.id) : null;
  const items = o.lines.map((l) => `${l.quantity} × ${l.description}`).join(', ');
  const properties = {
    dealname: `#${o.number}${o.contact ? ` · ${o.contact.company_name || o.contact.name}` : ''}`,
    amount: String(major(o.total, o.currency)),
    pipeline: str(ctx.connection.settings.pipeline) ?? 'default',
    dealstage: stageFor(o.status, ctx.connection.settings),
    closedate: o.starts_at,
    description: `${o.location.name}: ${o.starts_at.slice(0, 10)} – ${o.ends_at.slice(0, 10)}. ${items}`.slice(0, 65_000),
  };
  const known = await ctx.links.get('order', orderId);
  if (known) {
    await call(ctx, 'PATCH', `/crm/v3/objects/deals/${known.remoteId}`, { properties });
    return { status: 'done' as const, message: `Deal for #${o.number} updated` };
  }
  const deal = await call(ctx, 'POST', '/crm/v3/objects/deals', {
    properties,
    associations: contactId ? [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: DEAL_TO_CONTACT }] }] : undefined,
  });
  if (!deal?.id) throw new Error('HubSpot did not return a deal');
  await ctx.links.set('order', orderId, deal.id);
  return { status: 'done' as const, message: `Deal for #${o.number} created` };
}

export function hubspotIntegration(): IntegrationProvider {
  return {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    auth: {
      type: 'oauth2', authorizeUrl: AUTHORIZE, tokenUrl: TOKEN, clientAuth: 'body',
      scopes: ['oauth', 'crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.deals.read', 'crm.objects.deals.write'],
      clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
    },
    events: ['customer.created', 'customer.updated', 'order.created', 'order.updated', 'order.status_changed'],
    settings: [
      { key: 'pipeline', label: 'Deal pipeline', type: 'text', help: 'Internal pipeline id; default "default"' },
      { key: 'stage_quote', label: 'Stage for quotes', type: 'text', help: 'Default "contractsent"' },
      { key: 'stage_booked', label: 'Stage for confirmed bookings', type: 'text', help: 'Default "closedwon"' },
      { key: 'stage_lost', label: 'Stage for cancelled or expired bookings', type: 'text', help: 'Default "closedlost"' },
      { key: 'include_drafts', label: 'Also send drafts', type: 'boolean' },
    ],
    async onConnected(ctx) {
      const info = await call(ctx, 'GET', '/account-info/v3/details');
      if (!info?.portalId) throw new Error('No HubSpot account was shared');
      return { accountName: `HubSpot ${info.portalId}`, account: { portal_id: info.portalId, currency: info.companyCurrency ?? null } };
    },
    async handle(ctx, task) {
      if (task.object.type === 'order') return upsertDeal(ctx, task.object.id);
      if (task.object.type === 'customer') {
        const id = await upsertContact(ctx, task.object.id);
        return id ? { status: 'done', message: 'Contact saved' } : { status: 'skipped', message: 'Customer without email' };
      }
      return { status: 'skipped', message: `Nothing to do for ${task.event}` };
    },
  };
}

export default definePlugin({
  id: 'crm-hubspot',
  name: 'HubSpot CRM',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.3.0',
  permissions: ['integrations', 'network', 'orders:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'From your app at developers.hubspot.com; redirect URL as shown on the Integrations page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('HUBSPOT_CLIENT_ID'), client_secret: api.env('HUBSPOT_CLIENT_SECRET') });
    api.registerIntegration(hubspotIntegration());
  },
});
