import { randomBytes } from 'node:crypto';

/**
 * A stand-in for RFID readers and their bridges (FR-SCAN-7): EPCs for test units, and the messages a
 * reader posts in each format, sent to a reader's address as a real one would. A real read repeats each
 * tag several times, from more than one antenna; `repeats` does that.
 */
export type ReaderFormat = 'openrent' | 'zebra-iot' | 'impinj-connect';

/** A 96-bit EPC (24 hex digits), like the tags on rental gear. */
export const epc = () => `E280${randomBytes(10).toString('hex').toUpperCase()}`;

export function message(format: ReaderFormat, epcs: string[], opts: { repeats?: number; at?: Date } = {}): { contentType: string; body: string } {
  const at = opts.at ?? new Date();
  const reads = epcs.flatMap((e, i) => Array.from({ length: opts.repeats ?? 1 }, (_, k) => ({ epc: e, antenna: 1 + ((i + k) % 4), rssi: -40 - ((i * 7 + k) % 30), at: new Date(at.getTime() + k * 120) })));
  if (format === 'zebra-iot')
    return { contentType: 'application/json', body: JSON.stringify(reads.map((r, n) => ({ timestamp: r.at.toISOString(), type: 'SIMPLE', data: { eventNum: n + 1, format: 'epc', idHex: r.epc.toLowerCase(), antenna: r.antenna, peakRssi: r.rssi } }))) };
  if (format === 'impinj-connect') {
    const values = reads.map((r) => `${r.antenna},"${r.epc}",${r.at.getTime()}000,${r.rssi}`).join('\n');
    return {
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ reader_name: 'SpeedwayR-12-34-56', mac_address: '00:16:25:12:34:56', line_ending: '\n', field_delim: ',', field_names: 'antenna_port,epc,first_seen_timestamp,peak_rssi', field_values: values }).toString(),
    };
  }
  return { contentType: 'application/json', body: JSON.stringify({ reads: reads.map((r) => ({ epc: r.epc, read_at: r.at.toISOString(), antenna: r.antenna, rssi: r.rssi })) }) };
}

/** Posts a read to a reader's address with its token, as the reader or its bridge would. */
export async function sendReads(url: string, token: string, format: ReaderFormat, epcs: string[], opts: { repeats?: number; at?: Date } = {}) {
  const m = message(format, epcs, opts);
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': m.contentType }, body: m.body });
  return { status: res.status, body: await res.json().catch(() => null) };
}
