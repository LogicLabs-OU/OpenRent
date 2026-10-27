import { Secret, TOTP } from 'otpauth';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, account: string, issuer = 'OpenRent'): string {
  return new TOTP({ issuer, label: account, secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  return totpStep(secret, code) !== null;
}

/** The 30-second step a valid code belongs to (one step either side of now), or null. */
export function totpStep(secret: string, code: string, now = Date.now()): number | null {
  const totp = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
  const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1, timestamp: now });
  return delta === null ? null : Math.floor(now / 30_000) + delta;
}
