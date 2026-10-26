import { t as msg } from './i18n/index.ts';
import type { Actor, Role } from './context.ts';
import { forbidden } from './errors.ts';

/** Fixed roles (FR-USR-2). Permissions are `resource:action`; `*` grants everything. */
export const PERMISSIONS = [
  'tenant:read', 'tenant:write',
  'locations:read', 'locations:write',
  'users:read', 'users:write',
  'api_keys:manage',
  'catalog:read', 'catalog:write',
  'inventory:read', 'inventory:write',
  'pricing:read', 'pricing:write',
  'customers:read', 'customers:write',
  'orders:read', 'orders:write', 'orders:fulfil', 'orders:overbook',
  'deliveries:read', 'deliveries:write',
  'documents:read', 'documents:write',
  'payments:read', 'payments:write', 'payments:refund',
  'webhooks:manage',
  'reports:read',
  'audit:read',
  'plugins:manage',
  'themes:manage',
  'integrations:manage',
  'accounting:read', 'accounting:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number] | '*';

const READ = PERMISSIONS.filter((p) => p.endsWith(':read'));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ['*'],
  admin: ['*'],
  staff: [
    ...READ,
    'catalog:write', 'inventory:write', 'pricing:write',
    'customers:write', 'orders:write', 'orders:fulfil', 'documents:write', 'payments:write', 'deliveries:write',
  ],
  warehouse: [
    'catalog:read', 'inventory:read', 'inventory:write', 'orders:read', 'orders:fulfil',
    'customers:read', 'documents:read', 'locations:read', 'tenant:read', 'pricing:read', 'deliveries:read', 'deliveries:write',
  ],
  read_only: READ,
  // A custom role carries its own permissions on the actor.
  custom: [],
};

export function permissionsFor(actor: Actor): readonly Permission[] {
  if (actor.type === 'system') return ['*'];
  if (actor.type === 'api_key') return (actor.scopes ?? []) as Permission[];
  if (actor.type === 'user' && actor.role === 'custom') return (actor.permissions ?? []) as Permission[];
  if (actor.type === 'user' && actor.role) return ROLE_PERMISSIONS[actor.role];
  return [];
}

export function can(actor: Actor, perm: Permission): boolean {
  const granted = permissionsFor(actor);
  if (granted.includes('*') || granted.includes(perm)) return true;
  // `orders:write` implies `orders:fulfil`; a resource wildcard `orders:*` grants all actions.
  const [res] = perm.split(':');
  if (granted.includes(`${res}:*` as Permission)) return true;
  if (perm === 'orders:fulfil' && granted.includes('orders:write')) return true;
  return false;
}

export function assertCan(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw forbidden(msg('error.missing_permission', { perm }));
}
