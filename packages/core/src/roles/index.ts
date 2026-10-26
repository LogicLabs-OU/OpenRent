import type { Ctx, Role } from '../context.ts';
import { SYSTEM_ROLES } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../permissions.ts';

/**
 * Roles (FR-USR-3). The five fixed roles are listed as system roles that cannot change; a shop adds
 * its own with any set of permissions. Only owners change roles.
 */
export interface RoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

function ownerOnly(ctx: Ctx) {
  if (ctx.actor.type !== 'system' && ctx.actor.role !== 'owner') throw new AppError('forbidden', 403, msg('error.only_owners_change_roles'));
}

const systemRole = (key: (typeof SYSTEM_ROLES)[number], members: number) => ({
  id: key, object: 'role', system: true, key, name: msg(`role.${key}`), description: msg(`role.${key}.description`),
  permissions: [...ROLE_PERMISSIONS[key]], members, created_at: null, updated_at: null,
});

export function roleToApi(r: any) {
  return { id: r.id, object: 'role', system: false, key: 'custom', name: r.name, description: r.description, permissions: r.permissions ?? [], members: r.members ?? 0, created_at: r.created_at, updated_at: r.updated_at };
}

/** System roles first, then the shop's own, each with how many members have it. */
export async function listRoles(ctx: Ctx) {
  const counts = new Map(
    (await many<{ key: string; n: number }>(ctx, `SELECT coalesce(role_id, role) AS key, count(*)::int AS n FROM memberships WHERE disabled_at IS NULL GROUP BY 1`)).map((r) => [r.key, r.n]),
  );
  const custom = await many(ctx, `SELECT * FROM roles WHERE deleted_at IS NULL ORDER BY lower(name)`);
  return [...SYSTEM_ROLES.map((k) => systemRole(k, counts.get(k) ?? 0)), ...custom.map((r) => roleToApi({ ...r, members: counts.get(r.id) ?? 0 }))];
}

async function check(ctx: Ctx, input: RoleInput, id: string | null) {
  const errors: FieldError[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) errors.push({ field: 'name', code: 'required', message: msg('error.field.enter_a_name') });
    else if (SYSTEM_ROLES.some((k) => msg(`role.${k}`).toLowerCase() === name.toLowerCase()) || (await one(ctx, `SELECT 1 FROM roles WHERE lower(name) = lower($1) AND deleted_at IS NULL AND id IS DISTINCT FROM $2`, [name, id])))
      errors.push({ field: 'name', code: 'taken', message: msg('error.field.role_name_taken') });
  }
  for (const [i, p] of (input.permissions ?? []).entries()) {
    if (!(PERMISSIONS as readonly string[]).includes(p)) errors.push({ field: `permissions[${i}]`, code: 'invalid', message: msg('error.field.unknown_permission', { perm: p }) });
  }
  if (errors.length) throw invalid(msg('error.check_the_role'), errors);
}

export async function createRole(ctx: Ctx, input: RoleInput) {
  ownerOnly(ctx);
  await check(ctx, { ...input, name: input.name ?? '' }, null);
  const row = (
    await many(ctx, `INSERT INTO roles (id, tenant_id, name, description, permissions) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
      newId('rol'), ctx.tenantId, input.name!.trim(), input.description?.trim() ?? '', [...new Set(input.permissions ?? [])],
    ])
  )[0];
  await audit(ctx, { entity_type: 'role', entity_id: row.id, action: 'create', after: row });
  return roleToApi(row);
}

export async function updateRole(ctx: Ctx, id: string, input: RoleInput) {
  ownerOnly(ctx);
  if ((SYSTEM_ROLES as readonly string[]).includes(id)) throw new AppError('system_role', 409, msg('error.system_roles_fixed'));
  const before = await must<any>(ctx, `SELECT * FROM roles WHERE id = $1 AND deleted_at IS NULL`, [id], 'role', id);
  await check(ctx, input, id);
  const after = (
    await many(ctx, `UPDATE roles SET name = coalesce($2, name), description = coalesce($3, description), permissions = coalesce($4, permissions) WHERE id = $1 RETURNING *`, [
      id, input.name?.trim() ?? null, input.description?.trim() ?? null, input.permissions ? [...new Set(input.permissions)] : null,
    ])
  )[0];
  await audit(ctx, { entity_type: 'role', entity_id: id, action: 'update', before, after });
  return roleToApi(after);
}

/** A role still given to members cannot go. */
export async function deleteRole(ctx: Ctx, id: string) {
  ownerOnly(ctx);
  if ((SYSTEM_ROLES as readonly string[]).includes(id)) throw new AppError('system_role', 409, msg('error.system_roles_fixed'));
  const before = await must<any>(ctx, `SELECT * FROM roles WHERE id = $1 AND deleted_at IS NULL`, [id], 'role', id);
  const used = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM memberships WHERE role_id = $1`, [id]);
  if (used?.n) throw new AppError('role_in_use', 409, msg('error.role_in_use', { count: used.n }));
  await exec(ctx, `UPDATE roles SET deleted_at = now() WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'role', entity_id: id, action: 'delete', before });
}

/** A role given to a member: a system role key, or the id of one of the shop's roles. */
export async function resolveRole(ctx: Ctx, role: string): Promise<{ role: Role; role_id: string | null }> {
  if ((SYSTEM_ROLES as readonly string[]).includes(role)) return { role: role as Role, role_id: null };
  const r = await one<{ id: string }>(ctx, `SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL`, [role]);
  if (!r) throw invalid(msg('error.check_the_role'), [{ field: 'role', code: 'not_found', message: msg('error.field.unknown_role') }]);
  // Giving out a custom role is an owner's call, like changing it.
  ownerOnly(ctx);
  return { role: 'custom', role_id: r.id };
}
