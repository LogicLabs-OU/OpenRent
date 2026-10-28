import { bi } from '@openrent/core';
import { withTenant } from '@openrent/db';
import type { FastifyRequest } from 'fastify';
import type { Router } from '../http.ts';
import { makeCtx } from '../context.ts';
import { IdParams, Type } from '../schemas.ts';

/**
 * Database logins for BI tools (FR-REP-5): read-only views of this shop's data. These routes open their
 * own short transactions, because logins are database roles made on another connection between them.
 */
export function registerBi(r: Router) {
  const B = ['Data access'];
  const deps = r.deps;
  const inShop = (req: FastifyRequest): bi.InShop => (fn) => withTenant(deps.db, req.auth!.tenantId!, (c) => fn(makeCtx(deps, c, req)));
  r.get(
    '/bi_access',
    { permission: 'api_keys:manage', tx: 'none', tags: B, summary: 'Database logins for BI tools, where they connect and which views they read (passwords are shown only when made or rotated)' },
    async (_ctx, req) => bi.biAccess(inShop(req), deps.bi, req.log as any),
  );
  r.post(
    '/bi_access',
    {
      permission: 'api_keys:manage',
      tx: 'none',
      tags: B,
      summary: 'Make a database login for a BI tool; the response holds its password once',
      body: Type.Object({ name: Type.String({ maxLength: 100 }) }),
      status: 201,
    },
    async (_ctx, req) => bi.createBiLogin(inShop(req), deps.bi, req.log as any, req.body),
  );
  r.post(
    '/bi_access/:id/actions/rotate',
    { permission: 'api_keys:manage', tx: 'none', tags: B, summary: 'Give the login a new password (in the response, once); the old one stops working', params: IdParams, status: 200 },
    async (_ctx, req) => bi.rotateBiLogin(inShop(req), deps.bi, req.log as any, req.params.id),
  );
  r.delete(
    '/bi_access/:id',
    { permission: 'api_keys:manage', tx: 'none', tags: B, summary: 'Remove the login; its open sessions end', params: IdParams, status: 200 },
    async (_ctx, req) => bi.revokeBiLogin(inShop(req), deps.bi, req.params.id),
  );
}
