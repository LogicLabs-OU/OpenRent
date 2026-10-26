import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, SYSTEM_ROLES } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Custom roles and member access (FR-USR-3, PRD §5.4 user actions). */
suite('roles and members', () => {
  let t: TestApp;
  let owner: Client;
  let tenantId: string;
  let roleId: string;
  const ids: Record<string, string> = {};

  const sql = (text: string, values: unknown[] = []) => withTenant(t.deps.db, tenantId, async (c) => (await c.query(text, values)).rows);
  const member = async (email: string, role: string, password = 'password123') => {
    const r = await owner.post('/api/v1/users', { email, name: email.split('@')[0], role, password });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = new Client(t.app);
    expect((await c.post('/api/v1/auth/login', { email, password })).status).toBe(200);
    return { id: r.body.id as string, client: c };
  };

  beforeAll(async () => {
    ({ t, admin: owner, tenantId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps exactly the permissions of every built-in role', async () => {
    const list = (await owner.get('/api/v1/roles')).body.data;
    expect(list.filter((r: any) => r.system).map((r: any) => r.id)).toEqual([...SYSTEM_ROLES]);
    for (const key of SYSTEM_ROLES) {
      expect(list.find((r: any) => r.id === key).permissions).toEqual([...ROLE_PERMISSIONS[key]]);
      if (key === 'owner') continue;
      const m = await member(`sys-${key}@test.dev`, key);
      const me = (await m.client.get('/api/v1/auth/me')).body;
      expect([me.role, me.permissions]).toEqual([key, [...ROLE_PERMISSIONS[key]]]);
    }
  });

  it('creates a shop role field by field, owners only', async () => {
    const bad = await owner.post('/api/v1/roles', { name: 'Staff', permissions: ['orders:read', 'orders:fly'] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['name', 'permissions[1]']);
    const admin = await member('an-admin@test.dev', 'admin');
    expect((await admin.client.post('/api/v1/roles', { name: 'Counter', permissions: ['orders:read'] })).status).toBe(403);
    const r = await owner.post('/api/v1/roles', { name: 'Counter', description: 'Front desk', permissions: ['orders:read', 'orders:fulfil', 'customers:read'] });
    expect(r.status).toBe(201);
    roleId = r.body.id;
    expect(r.body).toMatchObject({ system: false, name: 'Counter', permissions: ['orders:read', 'orders:fulfil', 'customers:read'], members: 0 });
    expect((await admin.client.post('/api/v1/users', { email: 'x@test.dev', role: roleId })).status).toBe(403);
  });

  it('gives a member exactly the permissions of their shop role, as it changes', async () => {
    const m = await member('counter@test.dev', roleId);
    ids.counter = m.id;
    const me = (await m.client.get('/api/v1/auth/me')).body;
    expect([me.role, me.permissions]).toEqual(['custom', ['orders:read', 'orders:fulfil', 'customers:read']]);
    expect(me.memberships[0].role_name).toBe('Counter');
    expect((await m.client.get('/api/v1/orders')).status).toBe(200);
    const product = { type: 'rental', name: 'Tent', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 100 } };
    expect((await m.client.post('/api/v1/products', product)).status).toBe(403);
    await owner.patch(`/api/v1/roles/${roleId}`, { permissions: ['orders:read', 'catalog:read', 'catalog:write'] });
    expect((await m.client.post('/api/v1/products', product)).status).toBe(201);
    expect((await owner.get('/api/v1/roles')).body.data.find((r: any) => r.id === roleId).members).toBe(1);
    expect((await owner.patch('/api/v1/roles/staff', { name: 'Mine' })).body.code).toBe('system_role');
    expect((await owner.del(`/api/v1/roles/${roleId}`)).body.code).toBe('role_in_use');
    await owner.patch(`/api/v1/users/${m.id}`, { role: 'read_only' });
    expect((await owner.del(`/api/v1/roles/${roleId}`)).status).toBe(204);
  });

  it('turns a member’s access off and on, never the last owner’s', async () => {
    const m = await member('helper@test.dev', 'staff');
    expect((await owner.post(`/api/v1/users/${m.id}/actions/disable`, {})).body.status).toBe('disabled');
    expect((await m.client.get('/api/v1/orders')).status).toBe(401);
    expect((await owner.post(`/api/v1/users/${m.id}/actions/enable`, {})).body.status).toBe('active');
    const again = new Client(t.app);
    expect((await again.post('/api/v1/auth/login', { email: 'helper@test.dev', password: 'password123' })).status).toBe(200);
    expect((await again.get('/api/v1/orders')).status).toBe(200);
    const me = (await owner.get('/api/v1/auth/me')).body.user.id;
    expect((await owner.post(`/api/v1/users/${me}/actions/disable`, {})).body.code).toBe('cannot_disable_self');
  });

  it('invites by email and resets passwords; members then set their own', async () => {
    const r = await owner.post('/api/v1/users', { email: 'newbie@test.dev', name: 'Newbie', role: 'staff' });
    expect(r.body.has_password).toBe(false);
    expect((await owner.post(`/api/v1/users/${r.body.id}/actions/invite`, {})).body.sent_to).toBe('newbie@test.dev');
    const mail = (await sql(`SELECT subject, body_html FROM notifications WHERE template_key = 'staff_invitation' ORDER BY created_at DESC LIMIT 1`))[0];
    expect(mail.subject).toBe('You have been added to Test Rentals');
    const token = decodeURIComponent(/magic=([^"&]+)/.exec(mail.body_html.replace(/&#x3D;/g, '=').replace(/&amp;/g, '&'))![1]!);
    const c = new Client(t.app);
    expect((await c.post('/api/v1/auth/magic_link/verify', { token })).status).toBe(200);
    expect((await c.post('/api/v1/auth/me/password', { password: 'short' })).body.errors[0].field).toBe('password');
    expect((await c.post('/api/v1/auth/me/password', { password: 'first-password' })).status).toBe(200);
    expect((await c.post('/api/v1/auth/me/password', { password: 'second-password' })).body.errors[0].field).toBe('current_password');
    expect((await c.post('/api/v1/auth/me/password', { password: 'second-password', current_password: 'first-password' })).status).toBe(200);

    expect((await owner.post(`/api/v1/users/${r.body.id}/actions/reset_password`, {})).status).toBe(200);
    expect((await c.get('/api/v1/orders')).status).toBe(401);
    expect((await new Client(t.app).post('/api/v1/auth/login', { email: 'newbie@test.dev', password: 'second-password' })).status).toBe(401);
    expect((await owner.get(`/api/v1/users/${r.body.id}`)).body.has_password).toBe(false);
  });

  it('reads one role by id', async () => {
    expect((await owner.get('/api/v1/roles/staff')).body).toMatchObject({ id: 'staff', system: true, permissions: [...ROLE_PERMISSIONS.staff] });
    const own = await owner.post('/api/v1/roles', { name: 'Reader', permissions: ['orders:read'] });
    expect((await owner.get(`/api/v1/roles/${own.body.id}`)).body).toMatchObject({ id: own.body.id, system: false, permissions: ['orders:read'], members: 0 });
    expect((await owner.get('/api/v1/roles/rol_missing')).status).toBe(404);
  });
});
