import { definePlugin, type DomainEvent, type HookContext } from '@openrent/plugin-sdk';

/**
 * Staff notices in a Slack channel (FR-NOT-6): new bookings, failed payments, overdue returns and the
 * other notices staff get in the admin, sent to an incoming webhook. The shop chooses which kinds go
 * there; the text is the notice as staff read it, with a link to the booking.
 */
export const KINDS = ['staff_new_order', 'staff_payment_failed', 'staff_overdue', 'staff_delivery_failed', 'staff_service_due', 'deposit_expiring', 'staff_accounting_issue', 'staff_webhook_disabled'] as const;
const LABELS: Record<(typeof KINDS)[number], string> = {
  staff_new_order: 'New bookings',
  staff_payment_failed: 'Failed payments',
  staff_overdue: 'Overdue returns',
  staff_delivery_failed: 'Failed deliveries',
  staff_service_due: 'Service due',
  deposit_expiring: 'Card holds about to expire',
  staff_accounting_issue: 'Accounting problems',
  staff_webhook_disabled: 'Webhooks turned off',
};
const WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/;

export interface StaffNotice {
  kind: string;
  /** The notice in the shop's language. */
  text: string;
  /** Where it opens in the admin. */
  url: string | null;
}

/** Slack's mrkdwn needs &, < and > escaped; a link is <url|label>. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slackMessage(n: StaffNotice) {
  const text = n.url ? `${esc(n.text)} <${n.url}|Open>` : esc(n.text);
  return { text: text.slice(0, 3000) };
}

/** Kinds the shop sends to Slack; all of them until it turns some off. */
export const wanted = (config: Record<string, unknown>, kind: string) => (KINDS as readonly string[]).includes(kind) && config[`kind_${kind}`] !== false;

/** The webhook URL, which must be Slack's own unless the installation allows a test address. */
export function webhookUrl(config: Record<string, unknown>, allowAny = false) {
  const url = typeof config.webhook_url === 'string' ? config.webhook_url.trim() : '';
  return url && (WEBHOOK.test(url) || (allowAny && /^https?:\/\//.test(url))) ? url : null;
}

export async function postNotice(url: string, n: StaffNotice) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(slackMessage(n)), signal: AbortSignal.timeout(10_000) });
    if (res.ok) return;
    const reason = (await res.text().catch(() => '')).trim() || `HTTP ${res.status}`;
    // Slack allows about one message a second; wait once as it asks.
    if (res.status === 429 && attempt === 0) {
      await new Promise((ok) => setTimeout(ok, Math.min(5, Number(res.headers.get('retry-after')) || 1) * 1000));
      continue;
    }
    throw new Error(`Slack: ${reason}`);
  }
}

export default definePlugin({
  id: 'notify-slack',
  name: 'Slack notices',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.8.0',
  permissions: ['network'],
  settings: [
    { key: 'webhook_url', label: 'Incoming webhook URL', type: 'secret', required: true, help: 'From Slack: Apps → Incoming Webhooks → Add to a channel (https://hooks.slack.com/services/…)' },
    ...KINDS.map((k) => ({ key: `kind_${k}`, label: LABELS[k], type: 'boolean' as const, default: true })),
  ],
  setup(api) {
    const allowAny = api.env('SLACK_ALLOW_ANY_WEBHOOK') === '1';
    api.on('staff_notice.created', async (event: DomainEvent, ctx: HookContext) => {
      const n = event.data.object as StaffNotice;
      const config = (await ctx.scope?.config()) ?? {};
      const url = webhookUrl(config, allowAny);
      if (!url || !wanted(config, n.kind)) return;
      await postNotice(url, n);
    });
  },
});
