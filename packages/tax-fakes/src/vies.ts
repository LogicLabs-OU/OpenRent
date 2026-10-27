import { serve, type Req, type Reply } from './server.ts';

/**
 * VIES `POST /check-vat-number` with JSON `{ countryCode, vatNumber, requesterMemberStateCode?,
 * requesterNumber? }`. As VIES does: the country is a member state code (EL for Greece, XI for
 * Northern Ireland), the number has no country prefix, a malformed request gets 400 with
 * `INVALID_INPUT`, a member state that is down answers `MS_UNAVAILABLE`, and a check gives
 * `{ valid, name, address, requestDate, requestIdentifier }`. Unknown numbers are not valid, with
 * "---" for name and address. A request identifier comes only when a requester is named.
 */
export interface ViesNumber {
  name: string;
  address: string;
}

export interface ViesFake {
  url: string;
  /** Valid numbers by full number with prefix, e.g. `DE123456789`. */
  numbers: Record<string, ViesNumber>;
  /** Member states that answer MS_UNAVAILABLE. */
  down: Set<string>;
  requests: { countryCode: string; vatNumber: string; requester: string | null }[];
  close(): Promise<void>;
}

const STATES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
const fault = (status: number, error: string): Reply => ({ status, body: { actionSucceed: false, errorWrappers: [{ error, message: null }] } });

export async function startViesFake(opts: { numbers?: Record<string, ViesNumber> } = {}): Promise<ViesFake> {
  const numbers = { ...(opts.numbers ?? {}) };
  const down = new Set<string>();
  const requests: ViesFake['requests'] = [];
  let seq = 0;

  const handle = (req: Req): Reply => {
    if (req.method !== 'POST' || req.path !== '/check-vat-number') return { status: 404, body: { message: 'Not found' } };
    let body: any;
    try {
      body = JSON.parse(req.raw);
    } catch {
      return fault(400, 'INVALID_INPUT');
    }
    const cc = String(body?.countryCode ?? '');
    const num = String(body?.vatNumber ?? '');
    if (!STATES.has(cc) || !/^[0-9A-Z+*.]{2,12}$/.test(num)) return fault(400, 'INVALID_INPUT');
    const requester = body.requesterMemberStateCode && body.requesterNumber ? `${body.requesterMemberStateCode}${body.requesterNumber}` : null;
    requests.push({ countryCode: cc, vatNumber: num, requester });
    if (down.has(cc)) return fault(200, 'MS_UNAVAILABLE');
    const hit = numbers[`${cc}${num}`];
    return {
      status: 200,
      body: {
        countryCode: cc,
        vatNumber: num,
        requestDate: new Date().toISOString(),
        valid: !!hit,
        requestIdentifier: requester ? `WAPIAAAA${String(++seq).padStart(8, '0')}` : '',
        name: hit?.name ?? '---',
        address: hit?.address ?? '---',
        traderName: '---', traderStreet: '---', traderPostalCode: '---', traderCity: '---', traderCompanyType: '---',
        traderNameMatch: 'NOT_PROCESSED', traderStreetMatch: 'NOT_PROCESSED', traderPostalCodeMatch: 'NOT_PROCESSED', traderCityMatch: 'NOT_PROCESSED', traderCompanyTypeMatch: 'NOT_PROCESSED',
      },
    };
  };

  const server = await serve(handle);
  return { url: server.url, numbers, down, requests, close: server.close };
}
