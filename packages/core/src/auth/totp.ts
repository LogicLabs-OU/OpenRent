import { Secret, TOTP } from 'otpauth';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, account: string, issuer = 'OpenRent'): string {
  return new TOTP({ issuer, label: account, secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  const totp = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
  return totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) !== null;
}
