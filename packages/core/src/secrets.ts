import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretBox } from './context.ts';

/** AES-256-GCM secret box keyed by OPENRENT_ENCRYPTION_KEY (32 bytes, base64). Format: v1.<iv>.<tag>.<ciphertext>. */
export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('OPENRENT_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
    },
    decrypt(sealed) {
      const [v, iv, tag, data] = sealed.split('.');
      if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('unrecognised secret format');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
    },
  };
}
