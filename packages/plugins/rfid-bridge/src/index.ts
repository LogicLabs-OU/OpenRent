import { definePlugin, type TagRead, type TagReader } from '@openrent/plugin-sdk';

/**
 * RFID readers' own message formats (FR-SCAN-7). A reader, or the bridge software next to it, posts each
 * batch of reads to the address OpenRent gives the reader; these formats turn the batch into tag reads.
 * OpenRent's own JSON format needs no plugin: `{"reads": [{"epc": "…"}]}`.
 */

const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/**
 * Zebra readers (FX7500, FX9600, ATR7000) with the IoT Connector sending tag data events over HTTP POST:
 * one event or an array of them, `{ timestamp, type: "SIMPLE", data: { idHex, antenna, peakRssi } }`.
 */
export const zebraIotConnector: TagReader = {
  id: 'zebra-iot',
  name: { en: 'Zebra IoT Connector (HTTP POST)', de: 'Zebra IoT Connector (HTTP POST)', fr: 'Zebra IoT Connector (HTTP POST)', es: 'Zebra IoT Connector (HTTP POST)', et: 'Zebra IoT Connector (HTTP POST)', ja: 'Zebra IoT Connector（HTTP POST）', nl: 'Zebra IoT Connector (HTTP POST)' },
  parse(req) {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const reads: TagRead[] = [];
    for (const e of events as any[]) {
      const d = e?.data;
      if (!d || typeof d.idHex !== 'string') continue;
      reads.push({ epc: d.idHex, read_at: typeof e.timestamp === 'string' ? e.timestamp : null, antenna: Number.isInteger(d.antenna) ? d.antenna : null, rssi: typeof d.peakRssi === 'number' ? d.peakRssi : null });
    }
    return reads;
  },
};

/**
 * Impinj readers with Speedway Connect posting form data: `field_names` names the columns of the lines in
 * `field_values` (`field_delim` between columns, a line per read). The first-seen time is in microseconds.
 */
export const impinjSpeedwayConnect: TagReader = {
  id: 'impinj-connect',
  name: { en: 'Impinj Speedway Connect (HTTP POST)', de: 'Impinj Speedway Connect (HTTP POST)', fr: 'Impinj Speedway Connect (HTTP POST)', es: 'Impinj Speedway Connect (HTTP POST)', et: 'Impinj Speedway Connect (HTTP POST)', ja: 'Impinj Speedway Connect（HTTP POST）', nl: 'Impinj Speedway Connect (HTTP POST)' },
  parse(req) {
    const form = typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(req.rawBody.toString('utf8')));
    const delim = String(one(form.field_delim) ?? ',') || ',';
    const names = String(one(form.field_names) ?? '').split(delim).map((s) => s.trim().toLowerCase());
    const col = (n: string) => names.indexOf(n);
    const [epc, antenna, seen, rssi] = [col('epc'), col('antenna_port'), col('first_seen_timestamp'), col('peak_rssi')];
    if (epc < 0) return [];
    return String(one(form.field_values) ?? '')
      .split(/\r?\n/)
      .map((line) => line.split(delim).map((s) => s.trim().replace(/^"|"$/g, '')))
      .filter((f) => f[epc])
      .map((f) => ({
        epc: f[epc]!,
        antenna: antenna >= 0 && /^\d+$/.test(f[antenna] ?? '') ? Number(f[antenna]) : null,
        rssi: rssi >= 0 && f[rssi] && Number.isFinite(Number(f[rssi])) ? Number(f[rssi]) : null,
        read_at: seen >= 0 && /^\d{13,17}$/.test(f[seen] ?? '') ? new Date(Number(f[seen]!.slice(0, 13))).toISOString() : null,
      }));
  },
};

export default definePlugin({
  id: 'rfid-bridge',
  name: 'RFID reader formats',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.10.0',
  permissions: [],
  setup(api) {
    api.registerTagReader(zebraIotConnector);
    api.registerTagReader(impinjSpeedwayConnect);
  },
});
