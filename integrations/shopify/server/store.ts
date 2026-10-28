import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * What the app keeps per Shopify shop: its Shopify token, and its OpenRent connection with the sign-in under
 * way. Nothing about customers.
 */
export interface ShopRecord {
  shop: string;
  shopifyToken?: string;
  scope?: string;
  openrent?: {
    apiUrl: string;
    clientId: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    tenantName?: string;
    tenantSlug?: string;
    storefrontUrl?: string;
  };
  /** OpenRent sign-in under way: its state, PKCE verifier and when it lapses. */
  pending?: { state: string; verifier: string; until: number; locale?: string };
  /** Shopify install under way. */
  installState?: { state: string; until: number };
}

export interface Store {
  get(shop: string): Promise<ShopRecord | null>;
  set(record: ShopRecord): Promise<void>;
  delete(shop: string): Promise<void>;
  /** The shop with an OpenRent sign-in under way with this state. */
  byState(state: string): Promise<ShopRecord | null>;
}

export function memoryStore(): Store {
  const all = new Map<string, ShopRecord>();
  return {
    get: async (shop) => structuredClone(all.get(shop) ?? null),
    set: async (r) => void all.set(r.shop, structuredClone(r)),
    delete: async (shop) => void all.delete(shop),
    byState: async (state) => structuredClone([...all.values()].find((r) => r.pending?.state === state) ?? null),
  };
}

/** One JSON file per shop in `dir`; keep the folder private, it holds tokens. */
export function fileStore(dir: string): Store {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (shop: string) => path.join(dir, `${shop.replace(/[^a-z0-9.-]/gi, '_')}.json`);
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as ShopRecord;
  return {
    get: async (shop) => (existsSync(file(shop)) ? read(file(shop)) : null),
    set: async (r) => writeFileSync(file(r.shop), JSON.stringify(r), { mode: 0o600 }),
    delete: async (shop) => rmSync(file(shop), { force: true }),
    byState: async (state) => {
      const { readdirSync } = await import('node:fs');
      for (const f of readdirSync(dir)) if (f.endsWith('.json')) {
        const r = read(path.join(dir, f));
        if (r.pending?.state === state) return r;
      }
      return null;
    },
  };
}
