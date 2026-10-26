/**
 * Live check of the Twilio and MessageBird plugins against the real APIs. Opt-in: a provider is checked
 * only when its variables are set. Each check sends one text to TEXT_TO. With Twilio test credentials
 * and the magic sender +15005550006, or a MessageBird test_ key, nothing is delivered or charged.
 *
 *   TEXT_TO=+3725551234
 *   TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+15005550006   (test credentials)
 *   MESSAGEBIRD_ACCESS_KEY=test_... MESSAGEBIRD_ORIGINATOR=OpenRent
 *
 *   pnpm test:messaging-live
 */
import type { NotificationChannel, ProviderContext } from '@openrent/plugin-sdk';
import { twilioSmsChannel } from '@openrent/plugin-notify-twilio';
import { messageBirdChannel } from '@openrent/plugin-notify-messagebird';

const env = (k: string) => process.env[k]?.trim() ?? '';
const logger = { info() {}, warn() {}, error: console.error, debug() {} };
const checks: { name: string; channel: NotificationChannel; vars: string[]; config: Record<string, unknown> }[] = [
  { name: 'Twilio', channel: twilioSmsChannel(), vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'], config: { account_sid: env('TWILIO_ACCOUNT_SID'), auth_token: env('TWILIO_AUTH_TOKEN'), from: env('TWILIO_FROM') } },
  { name: 'MessageBird', channel: messageBirdChannel(), vars: ['MESSAGEBIRD_ACCESS_KEY', 'MESSAGEBIRD_ORIGINATOR'], config: { access_key: env('MESSAGEBIRD_ACCESS_KEY'), originator: env('MESSAGEBIRD_ORIGINATOR') } },
];

let ran = 0;
let failed = 0;
for (const c of checks) {
  if (!env('TEXT_TO') || !c.vars.every((k) => env(k))) {
    console.log(`${c.name}: skipped (set TEXT_TO, ${c.vars.join(', ')})`);
    continue;
  }
  ran++;
  console.log(`${c.name}:`);
  const ctx: ProviderContext = { tenantId: 'live-check', config: c.config, logger };
  try {
    const r = await c.channel.send(ctx, { to: env('TEXT_TO'), subject: '', html: '', text: 'OpenRent live check', template: 'test' });
    console.log(`  sent, ref ${r.ref}`);
    console.log('  ok');
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${(e as Error).message}`);
  }
}
if (!ran) console.log('Nothing to check: no credentials set.');
process.exit(failed ? 1 : 0);
