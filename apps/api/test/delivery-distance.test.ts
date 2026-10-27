import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNominatimFake, startOsrmFake, type NominatimFake, type OsrmFake } from '@openrent/geo-fakes';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const BERLIN = { lat: 52.5219, lon: 13.4132 };
const POTSDAM = { lat: 52.3906, lon: 13.0645 }; // about 27 km from the shop in a straight line
const HAMBURG = { lat: 53.5511, lon: 9.9937 }; // about 255 km

/** Delivery priced by distance (FR-PR-8): bands, the geocoder plugin, cached lookups and route exports. */
suite('delivery fee by distance', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let customer: string;
  let tent: string;
  let fee: string;
  let nominatim: NominatimFake;
  let osrm: OsrmFake;

  const quote = (options: Record<string, unknown>) =>
    admin.post('/api/v1/price_quote', { location_id: locationId, starts_at: isoIn(20), ends_at: isoIn(22), lines: [{ variant_id: tent, quantity: 1 }], options: { fees: [fee], ...options } });
  const feeLine = (b: any) => b.lines.find((l: any) => l.type === 'fee')?.subtotal.amount ?? null;
  const useGeocoder = (config: Record<string, unknown>) => admin.patch('/api/v1/plugins/geocode-osm', { enabled: true, config: { nominatim_url: nominatim.url, requests_per_second: 50, ...config } });

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    nominatim = await startNominatimFake({
      minIntervalMs: 0,
      places: [
        { match: 'alexanderplatz berlin', ...BERLIN, country: 'de' },
        { match: 'potsdam', ...POTSDAM, country: 'de' },
        { match: 'hamburg', ...HAMBURG, country: 'de' },
      ],
    });
    osrm = await startOsrmFake({ factor: 1.2 });
    await admin.patch(`/api/v1/locations/${locationId}`, { address: { line1: 'Alexanderplatz 1', postal_code: '10178', city: 'Berlin', country: 'DE' } });
    customer = (await admin.post('/api/v1/customers', { name: 'Far Customer', email: 'far@test.dev' })).body.id;
    tent = (await admin.post('/api/v1/products', { type: 'rental', name: 'Party tent', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${tent}/${locationId}`, { quantity: 5 });
  }, 120_000);

  afterAll(async () => {
    await nominatim?.close();
    await osrm?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('needs distance bands, each with a sensible distance', async () => {
    const none = await admin.post('/api/v1/fee_rules', { name: 'Delivery', kind: 'delivery', calculation: 'per_km', mode: 'optional' });
    expect([none.status, none.body.errors.map((e: any) => e.field)]).toEqual([422, ['distance_bands']]);
    const bad = await admin.post('/api/v1/fee_rules', { name: 'Delivery', kind: 'delivery', calculation: 'per_km', mode: 'optional', distance_bands: [{ up_to_km: 0, amount: 1000 }, { up_to_km: 20_000, amount: 1500 }, { up_to_km: null, amount: 2000 }] });
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['distance_bands[0].up_to_km', 'distance_bands[1].up_to_km']);
    const ok = await admin.post('/api/v1/fee_rules', {
      name: 'Delivery', kind: 'delivery', calculation: 'per_km', mode: 'optional',
      distance_bands: [{ up_to_km: 40, amount: 2500 }, { up_to_km: 10, amount: 1000 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.distance_bands).toEqual([{ up_to_km: 40, amount: 2500 }, { up_to_km: 10, amount: 1000 }]);
    fee = ok.body.id;
  });

  it('says what is missing before it can price the delivery', async () => {
    const offered = (await quote({ fees: [] })).body.optional_fees;
    expect(offered).toEqual([expect.objectContaining({ id: fee, amount: { amount: 0, currency: 'EUR' }, priced_by: 'distance', selected: false })]);
    expect((await quote({})).body.fee_errors).toEqual([{ fee_id: fee, reason: 'address_required' }]);
    // No geocoding plugin on yet: the address cannot be put on the map.
    expect((await quote({ address: 'Potsdam' })).body.fee_errors).toEqual([{ fee_id: fee, reason: 'address_not_found' }]);
    // A distance cannot come from the caller.
    expect((await quote({ address: 'Potsdam', distance: { km: 1 } })).status).toBe(400);
  });

  it('prices by the straight line times the road factor, and keeps each lookup', async () => {
    await useGeocoder({ road_factor: 1.3 });
    const near = await quote({ address: 'Potsdam' });
    expect([near.body.fee_errors, feeLine(near.body)]).toEqual([[], 2500]);
    const searched = nominatim.searches.length;
    expect(searched).toBe(2);
    await quote({ address: '  POTSDAM ' });
    expect(nominatim.searches.length).toBe(searched);
    expect((await quote({ address: 'Hamburg' })).body.fee_errors).toEqual([{ fee_id: fee, reason: 'address_too_far' }]);
    expect((await quote({ address: 'Atlantis 1' })).body.fee_errors).toEqual([{ fee_id: fee, reason: 'address_not_found' }]);
  });

  it('prices by road with an OSRM server', async () => {
    await useGeocoder({ osrm_url: osrm.url });
    // By road the trip is 1.2 × 27 km; a road of 8 km would fall into the first band.
    expect(feeLine((await quote({ address: 'Potsdam' })).body)).toBe(2500);
    osrm.roads[`${BERLIN.lon.toFixed(4)},${BERLIN.lat.toFixed(4)};${POTSDAM.lon.toFixed(4)},${POTSDAM.lat.toFixed(4)}`] = 8000;
    expect(feeLine((await quote({ address: 'Potsdam' })).body)).toBe(1000);
    expect(osrm.requests.length).toBe(2);
  });

  it('charges the fee on the order and puts its deliveries on the map', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, location_id: locationId, starts_at: isoIn(20), ends_at: isoIn(22), lines: [{ variant_id: tent, quantity: 1 }], options: { fees: [fee], address: 'Potsdam' } })).body;
    expect(o.lines.filter((l: any) => l.type === 'fee').map((l: any) => l.subtotal.amount)).toEqual([1000]);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).status).toBe(200);
    const start = new Date(o.starts_at);
    const d = await admin.post(`/api/v1/orders/${o.id}/deliveries`, {
      kind: 'delivery', window_start: new Date(start.getTime() - 2 * 3600_000).toISOString(), window_end: start.toISOString(), address: { line1: 'Am Neuen Garten 1', city: 'Potsdam' },
    });
    expect([d.status, d.body.detail]).toEqual([201, undefined]);
    const got = (await admin.get(`/api/v1/deliveries/${d.body.id}`)).body;
    expect(got.map).toEqual(POTSDAM);
    const gpx = await admin.get(`/api/v1/deliveries/route?date=${got.route_date}&format=gpx`);
    expect(gpx.headers['content-type']).toContain('application/gpx+xml');
    expect(gpx.body).toContain(`<rtept lat="${POTSDAM.lat}" lon="${POTSDAM.lon}">`);
    // Re-addressed somewhere the map does not know: no stale point.
    await admin.patch(`/api/v1/deliveries/${d.body.id}`, { address: { line1: 'Nowhere 9' } });
    expect((await admin.get(`/api/v1/deliveries/${d.body.id}`)).body.map).toBeNull();
  });
});
