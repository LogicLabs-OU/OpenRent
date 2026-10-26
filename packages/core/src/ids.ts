import { monotonicFactory } from 'ulid';
import { createHash, randomBytes } from 'node:crypto';

const next = monotonicFactory();

export type IdPrefix =
  | 'ten' | 'loc' | 'blk' | 'usr' | 'mem' | 'ses' | 'ltk' | 'key' | 'aud' | 'cat' | 'tax' | 'prs'
  | 'prod' | 'var' | 'sti' | 'adj' | 'bun' | 'bnc' | 'cus' | 'cpn' | 'ord' | 'oln' | 'olu' | 'oev'
  | 'dwn' | 'alc' | 'doc' | 'dtp' | 'ppr' | 'pay' | 'pin' | 'pev' | 'dep' | 'dmg' | 'ntp' | 'ntf'
  | 'whe' | 'evt' | 'whd' | 'cs' | 'plg' | 'req' | 'fil' | 'pim' | 'imp' | 'prq' | 'cct' | 'mtk' | 'stk' | 'sts'
  | 'cltk' | 'cses' | 'creq' | 'cal' | 'att' | 'cfd' | 'rci' | 'stn' | 'job' | 'dom' | 'cth' | 'prl' | 'fee' | 'xreq' | 'dlv' | 'ovb' | 'trf' | 'trl' | 'mtu' | 'itp' | 'ins' | 'mtr' | 'svi' | 'sev';

/** Prefixed ULID (`ord_01J...`). Opaque to clients (PRD §5.1). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${next()}`;
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

const BARCODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Short scannable code (Code 128 / QR friendly), e.g. `OR-7KQ2M9XA`. */
export function newBarcode(prefix = 'OR'): string {
  const b = randomBytes(8);
  let s = '';
  for (const byte of b) s += BARCODE_ALPHABET[byte % BARCODE_ALPHABET.length];
  return `${prefix}-${s}`;
}
