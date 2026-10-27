import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crossRates, ecbRates, parseEcb } from '../src/index.ts';

export const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube><Cube time='2026-10-26'><Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8350'/><Cube currency='JPY' rate='162.40'/><Cube currency='SEK' rate='11.512'/></Cube></Cube>
</gesmes:Envelope>`;

describe('ECB exchange rates', () => {
  let server: Server;
  let url = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(req.url === '/down' ? 503 : 200, { 'content-type': 'application/xml' });
      res.end(req.url === '/down' ? '' : ECB_XML);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('reads the date and the euro rates', () => {
    expect(parseEcb(ECB_XML)).toEqual({ date: '2026-10-26', eur: { EUR: 1, USD: 1.0812, GBP: 0.835, JPY: 162.4, SEK: 11.512 } });
    expect(() => parseEcb('<html/>')).toThrow('no date');
  });

  it('works out cross rates for a shop in another currency', () => {
    const { eur } = parseEcb(ECB_XML);
    expect(crossRates(eur, 'EUR', ['USD', 'XXX'])).toEqual({ USD: 1.0812 });
    const sek = crossRates(eur, 'SEK', ['EUR', 'USD']);
    expect(sek.EUR).toBeCloseTo(1 / 11.512, 8);
    expect(sek.USD).toBeCloseTo(1.0812 / 11.512, 8);
    expect(() => crossRates(eur, 'ISK', ['EUR'])).toThrow('no rate for ISK');
  });

  it('fetches the daily file', async () => {
    const r = await ecbRates().rates({ tenantId: 't', config: { url }, logger: console as any }, 'GBP', ['EUR', 'USD']);
    expect(r.date).toBe('2026-10-26');
    expect(r.rates.EUR).toBeCloseTo(1 / 0.835, 6);
    await expect(ecbRates().rates({ tenantId: 't', config: { url: `${url}/down` }, logger: console as any }, 'EUR', ['USD'])).rejects.toThrow('HTTP 503');
  });
});
