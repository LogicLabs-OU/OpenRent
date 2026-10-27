import { accounts, customers, type Ctx, type Permission } from '@openrent/core';
import type { Router } from '../http.ts';
import { Address, BillingDetails, Id, Nullable, Type } from '../schemas.ts';

const ProfileBody = BillingDetails;
const AddressBody = Type.Object(
  {
    label: Type.Optional(Nullable(Type.String({ maxLength: 80 }))),
    recipient: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    phone: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
    address: Type.Optional(Nullable(Address)),
    is_default: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Whose details a request works on, and the context to do it in (as the customer, or as staff). */
type Owner = (ctx: Ctx, req: any) => Promise<{ ctx: Ctx; customerId: string }>;

/**
 * Billing details and delivery addresses (ADR 0012) under `base`: the signed-in customer's in the
 * storefront and the portal, any customer's for staff.
 */
function register(r: Router, base: string, tags: string[], owner: Owner, perms: { read?: Permission; write?: Permission }, params: Record<string, any>) {
  const P = (extra: Record<string, any>) => Type.Object({ ...params, ...extra });
  const one = P({ profile_id: Id });
  const addr = P({ address_id: Id });
  const p = Object.keys(params).length ? { params: P({}) } : {};
  r.get(`${base}/billing_profiles`, { permission: perms.read, tags, summary: 'Saved billing details, the default first', ...p }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return { object: 'list', data: await customers.listProfiles(o.ctx, o.customerId) };
  });
  r.post(`${base}/billing_profiles`, { permission: perms.write, tags, summary: 'Save billing details: private, or a company with its tax number (checked when the shop has a tax plugin)', body: ProfileBody, ...p }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return customers.saveProfile(o.ctx, o.customerId, req.body);
  });
  r.patch(`${base}/billing_profiles/:profile_id`, { permission: perms.write, tags, summary: 'Change saved billing details, or make them the default', params: one, body: ProfileBody }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return customers.saveProfile(o.ctx, o.customerId, req.body, req.params.profile_id);
  });
  r.delete(`${base}/billing_profiles/:profile_id`, { permission: perms.write, tags, summary: 'Delete saved billing details (orders keep their copy)', params: one }, async (ctx, req) => {
    const o = await owner(ctx, req);
    await customers.deleteProfile(o.ctx, o.customerId, req.params.profile_id);
  });
  r.get(`${base}/addresses`, { permission: perms.read, tags, summary: 'Saved delivery addresses, the default first', ...p }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return { object: 'list', data: await customers.listAddresses(o.ctx, o.customerId) };
  });
  r.post(`${base}/addresses`, { permission: perms.write, tags, summary: 'Save a delivery address', body: AddressBody, ...p }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return customers.saveAddress(o.ctx, o.customerId, req.body);
  });
  r.patch(`${base}/addresses/:address_id`, { permission: perms.write, tags, summary: 'Change a saved delivery address, or make it the default', params: addr, body: AddressBody }, async (ctx, req) => {
    const o = await owner(ctx, req);
    return customers.saveAddress(o.ctx, o.customerId, req.body, req.params.address_id);
  });
  r.delete(`${base}/addresses/:address_id`, { permission: perms.write, tags, summary: 'Delete a saved delivery address', params: addr }, async (ctx, req) => {
    const o = await owner(ctx, req);
    await customers.deleteAddress(o.ctx, o.customerId, req.params.address_id);
  });
}

export function registerBillingProfiles(r: Router) {
  const signedIn: Owner = async (ctx, req) => {
    const { email } = await accounts.resolveSession(ctx, String(req.headers['x-customer-session'] ?? ''));
    const c = await accounts.accountCustomer(ctx, email);
    return { ctx: accounts.asCustomerCtx(ctx, c.id), customerId: c.id };
  };
  register(r, '/storefront/account', ['Customer accounts'], signedIn, {}, {});
  register(r, '/portal/me', ['Portal'], signedIn, {}, {});
  register(r, '/customers/:id', ['Customers'], async (ctx, req) => {
    await customers.getCustomer(ctx, req.params.id);
    return { ctx, customerId: req.params.id };
  }, { read: 'customers:read', write: 'customers:write' }, { id: Id });
}
