import type { Logger, PluginRuntime } from '@openrent/plugin-sdk';

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

/** Anything that can run a parameterised query: a pg PoolClient inside a transaction. */
export interface Queryable {
  query<R = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export type Role = 'owner' | 'admin' | 'staff' | 'warehouse' | 'read_only' | 'custom';
/** The five roles every shop has; 'custom' points to one of the shop's own (FR-USR-3). */
export const SYSTEM_ROLES = ['owner', 'admin', 'staff', 'warehouse', 'read_only'] as const;

export interface Actor {
  type: 'user' | 'api_key' | 'system' | 'customer' | 'storefront';
  id: string | null;
  role?: Role;
  scopes?: string[];
  /** The permissions of a custom role. */
  permissions?: string[];
}

export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

export interface CoreConfig {
  publicUrl: string;
  adminUrl: string;
  storefrontUrl: string;
  livemode: boolean;
}

/** Everything a domain service needs. One Ctx per request transaction. */
export interface Ctx {
  db: Queryable;
  tenantId: string;
  actor: Actor;
  now: Date;
  requestId?: string;
  idempotencyKey?: string;
  ip?: string;
  userAgent?: string;
  plugins: PluginRuntime;
  secrets: SecretBox;
  config: CoreConfig;
  logger: Logger;
}

export const consoleLogger: Logger = {
  info: (o, m) => console.log(m ?? '', o),
  warn: (o, m) => console.warn(m ?? '', o),
  error: (o, m) => console.error(m ?? '', o),
  debug: () => undefined,
};
