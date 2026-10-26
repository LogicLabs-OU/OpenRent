import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { classifySmtpError, smtpChannel, transportOptions } from '../src/index.ts';

const received: { from: string; to: string[]; raw: string }[] = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString()));
      stream.on('end', () => {
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ctx = (config: Record<string, unknown>) => ({ tenantId: 'ten_1', config, logger: console });

describe('smtp channel', () => {
  it('builds transport options from host settings or a URL', () => {
    expect(transportOptions({})).toBeNull();
    expect(transportOptions({ smtp_url: 'smtp://a:b@mail:25' })).toBe('smtp://a:b@mail:25');
    expect(transportOptions({ host: 'mail', security: 'tls' })).toMatchObject({ host: 'mail', port: 465, secure: true });
    expect(transportOptions({ host: 'mail', port: 2525, security: 'none', username: 'u', password: 'p' })).toMatchObject({ port: 2525, ignoreTLS: true, auth: { user: 'u', pass: 'p' } });
  });

  it('delivers a message with an attachment to an SMTP server', async () => {
    const c = ctx({ host: '127.0.0.1', port, security: 'none', from: 'Shop <shop@example.com>', reply_to: 'help@example.com' });
    expect(smtpChannel.isConfigured(c)).toBe(true);
    const res = await smtpChannel.send(c, {
      to: 'customer@example.com',
      subject: 'Your booking #1001',
      html: '<p>Thanks &amp; see you</p>',
      attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.7 test') }],
    });
    expect(res.ref).toBeTruthy();
    const mail = received.at(-1)!;
    expect(mail.to).toEqual(['customer@example.com']);
    expect(mail.from).toBe('shop@example.com');
    expect(mail.raw).toContain('Subject: Your booking #1001');
    expect(mail.raw).toContain('Reply-To: help@example.com');
    expect(mail.raw).toContain('filename=invoice.pdf');
    expect(mail.raw).toContain('Thanks & see you');
  });

  it('explains a TLS setting that does not match the port', async () => {
    const c = ctx({ host: '127.0.0.1', port, security: 'tls' });
    await expect(smtpChannel.send(c, { to: 'x@example.com', subject: 's', html: 'h' })).rejects.toMatchObject({ name: 'DeliveryError', code: 'tls_mismatch', permanent: false });
  });

  it('classifies common server answers', () => {
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' })).toMatchObject({ code: 'auth_failed', permanent: false });
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 550, message: 'No such user' })).toMatchObject({ code: 'recipient_rejected', permanent: true });
    expect(classifySmtpError({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.nope' })).toMatchObject({ code: 'host_not_found' });
    expect(classifySmtpError({ code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:1' })).toMatchObject({ code: 'connection_failed' });
    expect(classifySmtpError({ message: 'self-signed certificate in certificate chain' })).toMatchObject({ code: 'certificate' });
  });
});

