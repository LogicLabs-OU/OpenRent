import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { can, type Permission } from '@openrent/core';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Every route that needs a permission, as the OpenAPI document lists it. */
const spec = JSON.parse(readFileSync(new URL('../../../packages/api-spec/openapi.json', import.meta.url), 'utf8'));
const routes: { method: string; path: string; permission: Permission }[] = [];
for (const [path, ops] of Object.entries<any>(spec.paths)) {
  for (const [method, op] of Object.entries<any>(ops)) if (op['x-permission']) routes.push({ method: method.toUpperCase(), path, permission: op['x-permission'] });
}
const ROLES = ['owner', 'admin', 'staff', 'warehouse', 'read_only'] as const;
/** Routes with a rule on top of their permission: only owners change roles (packages/core/src/roles). */
const OWNER_ONLY = new Set(['POST /api/v1/roles', 'PATCH /api/v1/roles/{id}', 'DELETE /api/v1/roles/{id}']);

/**
 * Definition of done (PRD §11.2): each permission against each role. A role without the permission gets
 * 403 before anything else happens; a role with it never gets 403 from the permission check (it may
 * get 400, 404 or 422 here, as the ids and bodies are made up).
 */
suite('permissions matrix', () => {
  let t: TestApp;
  let admin: Client;
  const as: Partial<Record<(typeof ROLES)[number], Client>> = {};

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    as.owner = admin;
    for (const role of ROLES.filter((r) => r !== 'owner')) {
      const email = `${role}@matrix.test`;
      expect((await admin.post('/api/v1/users', { email, name: role, role, password: 'matrix-password-1' })).status).toBe(201);
      const c = new Client(t.app);
      expect((await c.post('/api/v1/auth/login', { email, password: 'matrix-password-1' })).status).toBe(200);
      as[role] = c;
    }
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it(`covers ${routes.length} routes`, () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  for (const role of ROLES) {
    it(`gives ${role} exactly the routes its permissions allow`, async () => {
      const wrong: string[] = [];
      for (const r of routes) {
        // Made-up ids; a body of {} is never valid, so nothing changes.
        const url = `/api/v1${r.path.replace(/^\/api\/v1/, '').replace(/\{[^}]+\}/g, 'zz_matrix_none')}`;
        const res = await as[role]!.req(r.method, url, ['POST', 'PATCH', 'PUT'].includes(r.method) ? {} : undefined);
        const allowed = can({ type: 'user', id: 'u', role } as any, r.permission);
        const forbidden = res.status === 403 && res.body?.code === 'forbidden';
        if (OWNER_ONLY.has(`${r.method} ${r.path}`) && role !== 'owner') continue;
        if (allowed === forbidden) wrong.push(`${r.method} ${r.path} (${r.permission}): ${res.status}`);
      }
      expect(wrong).toEqual([]);
    }, 120_000);
  }
});
