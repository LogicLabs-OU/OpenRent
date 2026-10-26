import nodemailer, { type Transporter } from 'nodemailer';
import {
  DeliveryError,
  definePlugin,
  type NotificationChannel,
  type ProviderContext,
} from '@openrent/plugin-sdk';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Nodemailer transport options from a tenant's settings: an SMTP URL, or host/port/security/login. */
export function transportOptions(config: Record<string, unknown>): string | Record<string, unknown> | null {
  const url = str(config.smtp_url);
  const host = str(config.host);
  if (host) {
    const security = str(config.security) ?? 'starttls';
    const port = Number(config.port) || (security === 'tls' ? 465 : 587);
    const user = str(config.username);
    return {
      host,
      port,
      secure: security === 'tls',
      requireTLS: security === 'starttls',
      ignoreTLS: security === 'none',
      auth: user ? { user, pass: String(config.password ?? '') } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
    };
  }
  return url;
}

const transports = new Map<string, Transporter>();

function transport(config: Record<string, unknown>): Transporter {
  const opts = transportOptions(config);
  if (!opts) throw new DeliveryError('not_configured', 'SMTP is not configured');
  const key = JSON.stringify(opts);
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport(opts as any);
    transports.set(key, t);
  }
  return t;
}

export const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Maps nodemailer and OpenSSL errors to a cause the shop owner can act on. */
export function classifySmtpError(err: any): DeliveryError {
  const msg = String(err?.message ?? err);
  const code = String(err?.code ?? '');
  const response = Number(err?.responseCode ?? 0);
  if (
    /wrong version number|packet length too long|unknown protocol|ssl3_get_record|tls_validate_record_header/i.test(
      msg,
    )
  )
    return new DeliveryError('tls_mismatch', msg, { cause: err });
  if (/certificate|self[- ]signed|CERT_|unable to verify/i.test(msg) || /CERT/.test(code))
    return new DeliveryError('certificate', msg, { cause: err });
  if (code === 'EAUTH' || response === 535 || response === 534)
    return new DeliveryError('auth_failed', msg, { cause: err });
  if (code === 'EENVELOPE' || (response >= 550 && response <= 553))
    return new DeliveryError('recipient_rejected', msg, { permanent: true, cause: err });
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(msg))
    return new DeliveryError('host_not_found', msg, { cause: err });
  if (/ETIMEDOUT|timeout|Greeting never received/i.test(msg) || code === 'ETIMEDOUT')
    return new DeliveryError('timeout', msg, { cause: err });
  if (code === 'ECONNECTION' || code === 'ESOCKET' || /ECONNREFUSED|ECONNRESET|EHOSTUNREACH/.test(msg))
    return new DeliveryError('connection_failed', msg, { cause: err });
  if (response >= 500 && code === 'EMESSAGE')
    return new DeliveryError('rejected', msg, { permanent: true, cause: err });
  return new DeliveryError('rejected', msg, { cause: err });
}

export const smtpChannel: NotificationChannel = {
  id: 'smtp',
  channel: 'email',
  isConfigured: (ctx: ProviderContext) => transportOptions(ctx.config) !== null,
  async send(ctx, msg) {
    if (!transportOptions(ctx.config)) throw new DeliveryError('not_configured', 'SMTP is not configured');
    const info = await transport(ctx.config)
      .sendMail({
        from: msg.from ?? str(ctx.config.from) ?? 'OpenRent <no-reply@localhost>',
        to: msg.to,
        replyTo: msg.replyTo ?? str(ctx.config.reply_to) ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text ?? htmlToText(msg.html),
        headers: msg.headers,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        })),
      })
      .catch((err: unknown) => {
        throw classifySmtpError(err);
      });
    return { ref: info.messageId ?? null };
  },
};

/**
 * First-party email over SMTP (FR-NOT-1). Each shop sets its own server in Settings → Plugins or
 * Settings → Email; SMTP_URL and EMAIL_FROM are the installation defaults. Without either, messages
 * stay queued and are listed on each order.
 */
export default definePlugin({
  id: 'notify-smtp',
  name: 'SMTP email',
  version: '0.2.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.0.0',
  permissions: ['notifications:send'],
  settings: [
    { key: 'host', label: 'SMTP host', type: 'text', help: 'smtp.example.com' },
    { key: 'port', label: 'Port', type: 'number', help: '587 for STARTTLS, 465 for TLS' },
    { key: 'security', label: 'Security', type: 'select', options: ['starttls', 'tls', 'none'] },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'secret' },
    {
      key: 'smtp_url',
      label: 'SMTP URL (instead of host)',
      type: 'secret',
      help: 'smtp://user:pass@host:587',
    },
    { key: 'from', label: 'From address', type: 'text', help: 'Shop name <bookings@example.com>' },
    { key: 'reply_to', label: 'Reply-to address', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ smtp_url: api.env('SMTP_URL'), from: api.env('EMAIL_FROM') });
    api.registerNotificationChannel(smtpChannel);
  },
});
