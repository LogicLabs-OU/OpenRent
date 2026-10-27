import { tenancy, payments, roles, exportTenant, listAudit, resolveSettings, AppError, PERMISSIONS } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { Id, IdParams, Json, ListQuery, Nullable, Type } from '../schemas.ts';
import { sendSheet } from '../spreadsheets.ts';

/** A built-in role (owner, admin, staff, warehouse, read_only) or the id of one of the shop's roles. */
const RoleT = Type.String({ minLength: 1, maxLength: 64, description: 'owner, admin, staff, warehouse, read_only, or a role id' });
const OpeningHours = Type.Record(Type.String(), Type.Array(Type.Array(Type.String({ pattern: '^\\d{2}:\\d{2}$' }), { minItems: 2, maxItems: 2 })));

export function registerTenant(r: Router) {
  const T = ['Tenant'];
  r.get('/tenant', { permission: 'tenant:read', tags: T, summary: 'Get the tenant' }, async (ctx) => tenancy.tenantToApi(await tenancy.getTenant(ctx)));
  r.get('/tenant/usage', { permission: 'tenant:read', tags: T, summary: 'This month’s orders, stored files and plugins turned on, against the shop’s limits (managed cloud)' }, async (ctx) => {
    const t = await ctx.db.query(`SELECT limits FROM tenants WHERE id = $1`, [ctx.tenantId]);
    return { object: 'shop_usage', limits: t.rows[0]?.limits ?? {}, usage: await tenancy.usageOf(ctx.db, ctx.tenantId) };
  });
  r.patch(
    '/tenant',
    {
      permission: 'tenant:write',
      tags: T,
      summary: 'Update tenant details and branding',
      body: Type.Object(
        {
          name: Type.Optional(Type.String()), legal_name: Type.Optional(Nullable(Type.String())), address: Type.Optional(Json), tax_ids: Type.Optional(Type.Array(Json)),
          timezone: Type.Optional(Type.String()), locale: Type.Optional(Type.String()), currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })), branding: Type.Optional(Json),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => tenancy.tenantToApi(await tenancy.updateTenant(ctx, req.body)),
  );
  r.get('/tenant/settings', { permission: 'tenant:read', tags: T, summary: 'Effective settings (defaults merged)' }, async (ctx) => ({ object: 'tenant_settings', ...(await tenancy.getSettings(ctx)) }));
  r.patch('/tenant/settings', { permission: 'tenant:write', tags: T, summary: 'Deep-merge settings', body: Json }, async (ctx, req) => ({ object: 'tenant_settings', ...(await tenancy.updateSettings(ctx, req.body)) }));
  r.post('/tenant/settings/actions/refresh_rates', { permission: 'tenant:write', tags: T, summary: 'Update the exchange rates for display currencies now, from the chosen rates plugin', status: 200 }, async (ctx) => ({
    object: 'tenant_settings',
    ...(await tenancy.refreshRates(ctx, { strict: true })),
  }));
  r.get('/tenant/export', { permission: 'tenant:write', tags: T, summary: 'Full tenant export as JSON (FR-MIG-1)', raw: true }, async (ctx, _req, reply) => {
    const data = await exportTenant(ctx);
    reply.header('Content-Disposition', `attachment; filename="openrent-export-${ctx.now.toISOString().slice(0, 10)}.json"`);
    return reply.type('application/json').send(data);
  });

  const L = ['Locations'];
  const LocationBody = Type.Object(
    {
      name: Type.String({ minLength: 1 }), address: Type.Optional(Json), timezone: Type.Optional(Type.String()), opening_hours: Type.Optional(OpeningHours), delivery_windows: Type.Optional(OpeningHours), is_default: Type.Optional(Type.Boolean()),
      phone: Type.Optional(Nullable(Type.String({ maxLength: 50 }))), email: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
      tax_ids: Type.Optional(Type.Array(Type.Object({ type: Type.String({ maxLength: 20 }), value: Type.String({ maxLength: 50 }) }), { maxItems: 5 })),
      tax_profile_id: Type.Optional(Nullable(Id)),
    },
    { additionalProperties: false },
  );
  r.get('/locations', { permission: 'locations:read', tags: L, summary: 'List locations (archived=true adds the archived ones)', querystring: Type.Object({ archived: Type.Optional(Type.Boolean()) }) }, async (ctx, req) => ({
    object: 'list',
    data: await tenancy.listLocations(ctx, { archived: req.query.archived }),
  }));
  r.post('/locations/:id/actions/restore', { permission: 'locations:write', tags: L, summary: 'Restore an archived location', params: IdParams, status: 200 }, async (ctx, req) => tenancy.restoreLocation(ctx, req.params.id));
  r.post('/locations', { permission: 'locations:write', tags: L, summary: 'Create a location', body: LocationBody }, async (ctx, req) => tenancy.createLocation(ctx, req.body));
  r.get('/locations/:id', { permission: 'locations:read', tags: L, summary: 'Get a location', params: IdParams }, async (ctx, req) => tenancy.getLocation(ctx, req.params.id));
  r.patch('/locations/:id', { permission: 'locations:write', tags: L, summary: 'Update a location', params: IdParams, body: Type.Partial(LocationBody) }, async (ctx, req) => tenancy.updateLocation(ctx, req.params.id, req.body));
  r.delete('/locations/:id', { permission: 'locations:write', tags: L, summary: 'Delete a location', params: IdParams }, async (ctx, req) => tenancy.deleteLocation(ctx, req.params.id));
  r.get('/locations/:id/blackouts', { permission: 'locations:read', tags: L, summary: 'Upcoming blackout periods', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await tenancy.listBlackouts(ctx, req.params.id) }));
  r.post(
    '/locations/:id/blackouts',
    { permission: 'locations:write', tags: L, summary: 'Add a blackout period (shop closed)', params: IdParams, body: Type.Object({ starts_at: Type.String({ format: 'date-time' }), ends_at: Type.String({ format: 'date-time' }), reason: Type.Optional(Type.String()) }) },
    async (ctx, req) => tenancy.addBlackout(ctx, req.params.id, req.body),
  );
  r.delete('/blackouts/:id', { permission: 'locations:write', tags: L, summary: 'Remove a blackout', params: IdParams }, async (ctx, req) => tenancy.deleteBlackout(ctx, req.params.id));

  const U = ['Users'];
  r.get('/users', { permission: 'users:read', tags: U, summary: 'List members' }, async (ctx) => ({ object: 'list', data: await tenancy.listUsers(ctx) }));
  r.post(
    '/users',
    { permission: 'users:write', tags: U, summary: 'Add a member (creates the user if needed)', body: Type.Object({ email: Type.String({ format: 'email' }), name: Type.Optional(Type.String()), role: RoleT, password: Type.Optional(Type.String({ minLength: 8 })) }) },
    async (ctx, req) => tenancy.inviteUser(ctx, req.body),
  );
  r.get('/users/:id', { permission: 'users:read', tags: U, summary: 'Get a member', params: IdParams }, async (ctx, req) => tenancy.getUser(ctx, req.params.id));
  r.patch('/users/:id', { permission: 'users:write', tags: U, summary: 'Change role or profile', params: IdParams, body: Type.Object({ role: Type.Optional(RoleT), name: Type.Optional(Type.String()), locale: Type.Optional(Type.String()) }) }, async (ctx, req) =>
    tenancy.updateMember(ctx, req.params.id, req.body),
  );
  r.delete('/users/:id', { permission: 'users:write', tags: U, summary: 'Remove a member', params: IdParams }, async (ctx, req) => tenancy.removeMember(ctx, req.params.id));
  r.post('/users/:id/actions/invite', { permission: 'users:write', tags: U, summary: 'Email the member a sign-in link (valid three days)', params: IdParams, status: 200 }, async (ctx, req) =>
    tenancy.sendAccessLink(ctx, req.params.id, 'invite'),
  );
  r.post('/users/:id/actions/reset_password', { permission: 'users:write', tags: U, summary: 'Clear the password, end their sessions and email a sign-in link', params: IdParams, status: 200 }, async (ctx, req) =>
    tenancy.sendAccessLink(ctx, req.params.id, 'reset_password'),
  );
  r.post('/users/:id/actions/disable', { permission: 'users:write', tags: U, summary: 'Turn off the member’s access to this shop', params: IdParams, status: 200 }, async (ctx, req) => tenancy.disableMember(ctx, req.params.id));
  r.post('/users/:id/actions/enable', { permission: 'users:write', tags: U, summary: 'Turn the member’s access back on', params: IdParams, status: 200 }, async (ctx, req) => tenancy.enableMember(ctx, req.params.id));

  const RL = ['Roles'];
  const RoleBody = { name: Type.String({ maxLength: 100 }), description: Type.Optional(Type.String({ maxLength: 500 })), permissions: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 100 }) };
  r.get('/roles', { permission: 'users:read', tags: RL, summary: 'Built-in roles and the shop’s own, with member counts' }, async (ctx) => ({
    object: 'list',
    data: await roles.listRoles(ctx),
    permissions: PERMISSIONS,
  }));
  r.get('/roles/:id', { permission: 'users:read', tags: RL, summary: 'One role with its permissions and member count', params: IdParams }, async (ctx, req) => roles.getRole(ctx, req.params.id));
  r.post('/roles', { permission: 'users:write', tags: RL, summary: 'Create a role (owners only)', body: Type.Object(RoleBody, { additionalProperties: false }) }, async (ctx, req) => roles.createRole(ctx, req.body));
  r.patch('/roles/:id', { permission: 'users:write', tags: RL, summary: 'Change a role (owners only)', params: IdParams, body: Type.Partial(Type.Object(RoleBody, { additionalProperties: false })) }, async (ctx, req) =>
    roles.updateRole(ctx, req.params.id, req.body),
  );
  r.delete('/roles/:id', { permission: 'users:write', tags: RL, summary: 'Delete a role nobody has (owners only)', params: IdParams }, async (ctx, req) => roles.deleteRole(ctx, req.params.id));

  const K = ['API keys'];
  r.get('/api_keys', { permission: 'api_keys:manage', tags: K, summary: 'List API keys' }, async (ctx) => ({ object: 'list', data: await tenancy.listApiKeys(ctx) }));
  r.post(
    '/api_keys',
    { permission: 'api_keys:manage', tags: K, summary: 'Create an API key (the key is shown once)', body: Type.Object({ name: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('secret'), Type.Literal('publishable')]), scopes: Type.Optional(Type.Array(Type.String())) }) },
    async (ctx, req) => tenancy.createApiKey(ctx, req.body),
  );
  r.delete('/api_keys/:id', { permission: 'api_keys:manage', tags: K, summary: 'Revoke an API key', params: IdParams }, async (ctx, req) => tenancy.revokeApiKey(ctx, req.params.id));
  r.post('/api_keys/:id/actions/rotate', { permission: 'api_keys:manage', tags: K, summary: 'Revoke and replace a key', params: IdParams }, async (ctx, req) => tenancy.rotateApiKey(ctx, req.params.id));

  const P = ['Payments'];
  r.get('/payment_providers', { permission: 'payments:read', tags: P, summary: 'Installed payment providers and their state' }, async (ctx) => ({ object: 'list', data: await payments.listPaymentProviders(ctx, r.deps.plugins.statuses) }));
  r.patch(
    '/payment_providers/:id',
    { permission: 'tenant:write', tags: P, summary: 'Configure a provider (secrets are encrypted at rest)', params: IdParams, body: Type.Object({ enabled: Type.Optional(Type.Boolean()), mode: Type.Optional(Type.Union([Type.Literal('test'), Type.Literal('live')])), config: Type.Optional(Type.Record(Type.String(), Nullable(Type.String()))) }) },
    async (ctx, req) => payments.updatePaymentProvider(ctx, req.params.id, req.body),
  );

  r.get('/audit_log', { permission: 'audit:read', tags: ['Audit'], summary: 'Append-only audit log', querystring: ListQuery }, async (ctx, req) => listAudit(ctx, parseList(req.query)));
  r.get('/audit_log/export', { permission: 'audit:read', tags: ['Audit'], summary: 'Audit log as CSV or XLSX (same filters as the list, up to 10 000 entries)', querystring: ListQuery, raw: true }, async (ctx, req, reply) => {
    const params = parseList(req.query);
    const rows: string[][] = [];
    let cursor: string | undefined;
    do {
      const page: any = await listAudit(ctx, { ...params, limit: 200, cursor });
      for (const a of page.data) rows.push([new Date(a.created_at).toISOString(), a.actor_type, a.actor_name ?? a.actor_id ?? '', a.entity_type, a.entity_id, a.action, JSON.stringify(a.diff ?? {}), a.ip ?? '', a.request_id ?? '']);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor && rows.length < 10_000);
    const format = (req.query as any).format === 'xlsx' ? 'xlsx' : 'csv';
    return sendSheet(reply, { headers: ['created_at', 'actor_type', 'actor', 'entity_type', 'entity_id', 'action', 'changes', 'ip', 'request_id'], rows }, 'audit-log', format);
  });

  r.get('/tenant/settings/terms', { permission: 'tenant:read', tags: T, summary: 'Rental terms text and version' }, async (ctx) => {
    const s = resolveSettings((await tenancy.getTenant(ctx)).settings);
    return { object: 'terms', ...s.terms };
  });

  void Id;
  void AppError;
}
