import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.OPENRENT_OUTBOUND_ALLOW = 'allowed.test';
const { BlockedAddressError, guardedFetch, isBlockedAddress } = await import('../src/net/guard.ts');

/** The network guard for addresses shops and customers choose (SSRF). */
describe('network guard', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => (req.url === '/redirect' ? res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }).end() : res.end('internal')));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('knows private, reserved and special addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'fd00::1', 'fe80::1', 'fec0::1', 'not-an-ip']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('refuses loopback by address and by name, and other schemes', async () => {
    const cause = (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof BlockedAddressError ? e : e?.cause ?? e));
    expect(await cause(guardedFetch(`http://127.0.0.1:${port}/`))).toBeInstanceOf(BlockedAddressError);
    expect(await cause(guardedFetch(`http://localhost:${port}/`))).toBeInstanceOf(BlockedAddressError);
    expect(await cause(guardedFetch(`http://localhost.:${port}/`))).toBeInstanceOf(BlockedAddressError);
    expect(await cause(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`))).toBeInstanceOf(BlockedAddressError);
    expect(await cause(guardedFetch('http://metadata.google.internal/'))).toBeInstanceOf(BlockedAddressError);
    await expect(guardedFetch('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedAddressError);
  });
});
