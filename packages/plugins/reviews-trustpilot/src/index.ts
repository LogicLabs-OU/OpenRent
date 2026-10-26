import { definePlugin, type IntegrationContext, type IntegrationProvider } from '@openrent/plugin-sdk';

/**
 * Trustpilot review invitations: when a booking is fully returned, Trustpilot is asked to invite the
 * customer to review the shop, after a delay the shop chooses. Trustpilot sends the invitation itself,
 * once per booking.
 */
const API = 'https://api.trustpilot.com';
const INVITATIONS = 'https://invitations-api.trustpilot.com';
const RETURNED = ['returned', 'inspected', 'closed'];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const tokens = new Map<string, { token: string; until: number }>();

/** A business-user token from the API key and secret, kept until shortly before it expires. */
async function accessToken(ctx: IntegrationContext) {
  const key = String(ctx.credentials.api_key ?? '');
  const cached = tokens.get(key);
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await ctx.fetch(`${str(ctx.config.api_base_url) ?? API}/v1/oauth/oauth-business-users-for-applications/accesstoken`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${key}:${ctx.credentials.api_secret ?? ''}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) throw new Error(`Trustpilot: ${data?.error_description ?? data?.message ?? `HTTP ${res.status}`}`);
  tokens.set(key, { token: data.access_token, until: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 });
  return data.access_token as string;
}

/** When Trustpilot should send the invitation: `delay_days` after the return (default 1). */
export function sendTime(settings: Record<string, unknown>, now = Date.now()) {
  const days = Number(settings.delay_days ?? 1);
  return new Date(now + (Number.isFinite(days) && days >= 0 ? Math.min(days, 30) : 1) * 86_400_000).toISOString();
}

async function invite(ctx: IntegrationContext, orderId: string) {
  const o = await ctx.data.order(orderId);
  if (!o) return { status: 'skipped' as const, message: 'Order not found' };
  if (!RETURNED.includes(o.status)) return { status: 'skipped' as const, message: `#${o.number} is not fully returned yet` };
  if (!o.contact?.email) return { status: 'skipped' as const, message: `#${o.number} has no customer email` };
  if (await ctx.links.get('order', orderId)) return { status: 'skipped' as const, message: `#${o.number} was invited already` };
  const s = ctx.connection.settings;
  const unit = String(ctx.credentials.business_unit_id ?? '');
  const res = await ctx.fetch(`${str(ctx.config.invitations_base_url) ?? INVITATIONS}/v1/private/business-units/${encodeURIComponent(unit)}/email-invitations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(ctx)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      consumerEmail: o.contact.email, consumerName: o.contact.name, referenceNumber: `#${o.number}`,
      locale: str(s.locale) ?? 'en-US', senderName: str(s.sender_name) ?? undefined, replyTo: str(s.reply_to) ?? undefined,
      serviceReviewInvitation: { preferredSendTime: sendTime(s), templateId: str(s.template_id) ?? undefined },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Trustpilot: ${data?.message ?? data?.details ?? `HTTP ${res.status}`}`);
  }
  await ctx.links.set('order', orderId, `#${o.number}`);
  return { status: 'done' as const, message: `Review invitation for #${o.number} scheduled` };
}

export function trustpilotIntegration(): IntegrationProvider {
  return {
    id: 'trustpilot',
    name: 'Trustpilot',
    category: 'marketing',
    auth: {
      type: 'fields',
      fields: [
        { key: 'api_key', label: 'API key', type: 'text', required: true, help: 'From Trustpilot Business → Integrations → API' },
        { key: 'api_secret', label: 'API secret', type: 'secret', required: true },
        { key: 'business_unit_id', label: 'Business unit ID', type: 'text', required: true },
      ],
    },
    events: ['order.checked_in'],
    settings: [
      { key: 'delay_days', label: 'Days after the return', type: 'number', help: 'Default 1, at most 30' },
      { key: 'locale', label: 'Invitation language', type: 'text', help: 'e.g. en-GB, de-DE; default en-US' },
      { key: 'template_id', label: 'Invitation template ID', type: 'text', help: 'Empty uses your default template' },
      { key: 'sender_name', label: 'Sender name', type: 'text' },
      { key: 'reply_to', label: 'Reply-to email', type: 'text' },
    ],
    async onConnected(ctx) {
      await accessToken(ctx);
      const unit = String(ctx.credentials.business_unit_id ?? '');
      const res = await ctx.fetch(`${str(ctx.config.api_base_url) ?? API}/v1/business-units/${encodeURIComponent(unit)}?apikey=${encodeURIComponent(String(ctx.credentials.api_key ?? ''))}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 404 ? 'Unknown business unit ID' : `Trustpilot: HTTP ${res.status}`);
      return { accountName: data?.displayName ?? data?.name?.identifying ?? unit, account: { business_unit_id: unit } };
    },
    async handle(ctx, task) {
      if (task.object.type === 'order') return invite(ctx, task.object.id);
      return { status: 'skipped', message: `Nothing to do for ${task.event}` };
    },
  };
}

export default definePlugin({
  id: 'reviews-trustpilot',
  name: 'Trustpilot reviews',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.3.0',
  permissions: ['integrations', 'network', 'orders:read', 'customers:read'],
  settings: [
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'invitations_base_url', label: 'Invitations API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.registerIntegration(trustpilotIntegration());
  },
});
