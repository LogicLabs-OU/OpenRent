import { describe, expect, it } from 'vitest';
import { epc, message } from '@openrent/rfid-fakes';
import { impinjSpeedwayConnect, zebraIotConnector } from '../src/index.ts';

const parse = (reader: typeof zebraIotConnector, m: { contentType: string; body: string }) => {
  const rawBody = Buffer.from(m.body);
  const body = m.contentType.includes('json') ? JSON.parse(m.body) : Object.fromEntries(new URLSearchParams(m.body));
  return reader.parse({ headers: { 'content-type': m.contentType }, body, rawBody });
};

describe('RFID reader formats', () => {
  it('reads Zebra IoT Connector tag data events', () => {
    const tags = [epc(), epc()];
    const reads = parse(zebraIotConnector, message('zebra-iot', tags, { repeats: 2, at: new Date('2026-11-02T08:00:00Z') }));
    expect(reads).toHaveLength(4);
    expect(reads[0]).toEqual({ epc: tags[0]!.toLowerCase(), read_at: '2026-11-02T08:00:00.000Z', antenna: 1, rssi: -40 });
    // A single event, not in an array, and events without a tag are fine.
    expect(zebraIotConnector.parse({ headers: {}, body: { type: 'SIMPLE', data: { idHex: 'e2801170' } }, rawBody: Buffer.alloc(0) })).toEqual([{ epc: 'e2801170', read_at: null, antenna: null, rssi: null }]);
    expect(zebraIotConnector.parse({ headers: {}, body: [{ type: 'heartbeat', data: {} }], rawBody: Buffer.alloc(0) })).toEqual([]);
  });

  it('reads Impinj Speedway Connect form posts, by the columns named in field_names', () => {
    const tags = [epc(), epc(), epc()];
    const reads = parse(impinjSpeedwayConnect, message('impinj-connect', tags, { at: new Date('2026-11-02T08:00:00Z') }));
    expect(reads.map((r) => r.epc)).toEqual(tags);
    expect(reads[1]).toMatchObject({ antenna: 2, read_at: '2026-11-02T08:00:00.000Z' });
    // Columns in another order, separated by semicolons.
    const other = impinjSpeedwayConnect.parse({ headers: {}, body: { field_delim: ';', field_names: 'epc;peak_rssi', field_values: `${tags[0]};-61\n` }, rawBody: Buffer.alloc(0) });
    expect(other).toEqual([{ epc: tags[0], antenna: null, rssi: -61, read_at: null }]);
    expect(impinjSpeedwayConnect.parse({ headers: {}, body: { field_names: 'antenna_port', field_values: '1' }, rawBody: Buffer.alloc(0) })).toEqual([]);
  });
});
