import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNominatimFake, startOsrmFake, type NominatimFake, type OsrmFake } from '@openrent/geo-fakes';
import { osmGeocoder, rateFor } from '../src/index.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;
const BERLIN = { lat: 52.52, lon: 13.405 };
const POTSDAM = { lat: 52.3906, lon: 13.0645 };

describe('OpenStreetMap geocoding', () => {
  let nominatim: NominatimFake;
  let osrm: OsrmFake;
  beforeAll(async () => {
    nominatim = await startNominatimFake({
      minIntervalMs: 150,
      places: [
        { match: 'alexanderplatz berlin', ...BERLIN, country: 'de' },
        { match: 'potsdam', ...POTSDAM, country: 'de' },
        { match: 'island', lat: 52.6, lon: 13.5, country: 'de' },
      ],
    });
    osrm = await startOsrmFake({ factor: 1.2 });
  });
  afterAll(async () => {
    await nominatim.close();
    await osrm.close();
  });
  const ctx = (config: Record<string, unknown> = {}) => ({ tenantId: 't', logger, config: { nominatim_url: nominatim.url, requests_per_second: 5, email: 'ops@shop.test', ...config } });

  it('needs a contact for the public server only', () => {
    const g = osmGeocoder();
    expect(g.isConfigured({ tenantId: 't', logger, config: {} })).toBe(false);
    expect(g.isConfigured({ tenantId: 't', logger, config: { email: 'ops@shop.test' } })).toBe(true);
    expect(g.isConfigured({ tenantId: 't', logger, config: { nominatim_url: 'https://geo.shop.test' } })).toBe(true);
    expect(rateFor({ requests_per_second: 10 })).toBe(1);
    expect(rateFor({ nominatim_url: 'https://geo.shop.test', requests_per_second: 10 })).toBe(10);
  });

  it('finds an address, names itself and keeps to the rate', async () => {
    const g = osmGeocoder();
    const [a, b, c] = await Promise.all([
      g.geocode(ctx(), 'Alexanderplatz 1, 10178 Berlin'),
      g.geocode(ctx(), 'Potsdam'),
      g.geocode(ctx({ country_codes: 'at' }), 'Potsdam'),
    ]);
    expect(a).toEqual(BERLIN);
    expect(b).toEqual(POTSDAM);
    expect(c).toBeNull();
    expect(nominatim.throttled).toBe(0);
    expect(nominatim.searches.at(-1)).toMatchObject({ email: 'ops@shop.test' });
    expect(nominatim.searches.at(-1)!.userAgent).toMatch(/^OpenRent\/[\d.]+ \(geocode-osm; ops@shop\.test\)$/);
    expect(await g.geocode(ctx(), 'Nowhere 9')).toBeNull();
  });

  it('gives the distance by road with an OSRM server, and none without', async () => {
    const g = osmGeocoder();
    expect(await g.route!(ctx(), BERLIN, POTSDAM)).toBeNull();
    const r = await g.route!(ctx({ osrm_url: osrm.url }), BERLIN, POTSDAM);
    expect(r!.km).toBeGreaterThan(30);
    expect(r!.km).toBeLessThan(35);
    expect(osrm.requests.at(-1)).toBe(`${BERLIN.lon},${BERLIN.lat};${POTSDAM.lon},${POTSDAM.lat}`);
    osrm.roads[`${BERLIN.lon.toFixed(4)},${BERLIN.lat.toFixed(4)};13.5000,52.6000`] = null;
    expect(await g.route!(ctx({ osrm_url: osrm.url }), BERLIN, { lat: 52.6, lon: 13.5 })).toBeNull();
  });

  it('reports a server that refuses', async () => {
    await expect(osmGeocoder().geocode({ tenantId: 't', logger, config: { nominatim_url: `${nominatim.url}/nope`, requests_per_second: 5 } }, 'Potsdam')).rejects.toThrow('HTTP 404');
  });
});
