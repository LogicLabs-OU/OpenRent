import { accounts, customers, orders } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { sendSheet } from '../spreadsheets.ts';
import { Customer, CustomerInput, ExportQuery, CustomerPatch, Id, IdParams, ListQuery, Page, Type, ok } from '../schemas.ts';

export function registerCustomers(r: Router) {
  const C = ['Customers'];
  r.get('/customers', { permission: 'customers:read', tags: C, summary: 'List customers (filters: type, email, tag, blocked)', querystring: ListQuery, response: ok(Page(Customer)) }, async (ctx, req) =>
    customers.listCustomers(ctx, parseList(req.query)),
  );
  r.get('/customers/export', { permission: 'customers:read', tags: C, summary: 'Download the customer list as CSV or XLSX, with the list filters', querystring: ExportQuery, raw: true }, async (ctx, req, reply) =>
    sendSheet(reply, await customers.exportCustomers(ctx, parseList(req.query)), 'customers', req.query.format ?? 'csv'),
  );
  r.post('/customers', { permission: 'customers:write', tags: C, summary: 'Create a customer; response lists possible duplicates', body: CustomerInput, response: ok(Customer, 201) }, async (ctx, req) => customers.createCustomer(ctx, req.body));
  r.get('/customers/duplicates', { permission: 'customers:read', tags: C, summary: 'Find customers matching an email or phone', querystring: Type.Object({ email: Type.Optional(Type.String()), phone: Type.Optional(Type.String()) }) }, async (ctx, req) => ({
    object: 'list',
    data: await customers.findDuplicates(ctx, req.query.email, req.query.phone),
  }));
  r.get('/customers/:id', { permission: 'customers:read', tags: C, summary: 'Get a customer with history stats', params: IdParams, response: ok(Customer) }, async (ctx, req) => customers.getCustomer(ctx, req.params.id));
  r.patch('/customers/:id', { permission: 'customers:write', tags: C, summary: 'Update a customer', params: IdParams, body: CustomerPatch, response: ok(Customer) }, async (ctx, req) => customers.updateCustomer(ctx, req.params.id, req.body));
  r.delete('/customers/:id', { permission: 'customers:write', tags: C, summary: 'Delete a customer without orders', params: IdParams }, async (ctx, req) => customers.deleteCustomer(ctx, req.params.id));
  r.get('/customers/:id/orders', { permission: 'orders:read', tags: C, summary: "A customer's orders", params: IdParams, querystring: ListQuery }, async (ctx, req) => {
    const p = parseList(req.query);
    return orders.listOrders(ctx, { ...p, filters: { ...p.filters, customer_id: { eq: [req.params.id] } } });
  });
  r.get('/customers/:id/export', { permission: 'customers:write', tags: C, summary: 'GDPR export of everything held about a customer', params: IdParams }, async (ctx, req) => customers.exportCustomer(ctx, req.params.id));
  r.post('/customers/:id/actions/merge', { permission: 'customers:write', tags: C, summary: 'Merge another customer into this one', params: IdParams, body: Type.Object({ source_id: Id }), status: 200 }, async (ctx, req) =>
    customers.mergeCustomers(ctx, req.params.id, req.body.source_id),
  );
  r.post('/customers/:id/actions/check_tax_id', { permission: 'customers:write', tags: C, summary: 'Check the customer’s tax number again with the tax plugin (VIES for EU VAT numbers)', params: IdParams, status: 200 }, async (ctx, req) =>
    customers.recheckTaxId(ctx, req.params.id),
  );
  r.post('/customers/:id/actions/start_id_check', { permission: 'customers:write', tags: C, summary: 'Email the customer a link to verify their identity with the ID check service (FR-PAY-9)', params: IdParams, status: 200 }, async (ctx, req) => ({
    object: 'id_check',
    ...(await customers.startIdentityCheck(ctx, req.params.id, { notify: true })),
  }));
  r.post('/customers/:id/actions/send_portal_link', { permission: 'customers:write', tags: C, summary: 'Email the customer a link to their account, valid for a week (also before the first booking)', params: IdParams, status: 202 }, async (ctx, req) =>
    accounts.sendPortalLink(ctx, req.params.id),
  );
  r.post('/customers/:id/actions/invoice_now', { permission: 'documents:write', tags: C, summary: 'Put every finished booking not invoiced yet on one invoice (customers invoiced monthly)', params: IdParams, status: 201 }, async (ctx, req) =>
    customers.invoiceNow(ctx, req.params.id),
  );
  r.post('/customers/:id/actions/block', { permission: 'customers:write', tags: C, summary: 'Block online booking', params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String()) }), status: 200 }, async (ctx, req) =>
    customers.setBlocked(ctx, req.params.id, true, req.body?.reason),
  );
  r.post('/customers/:id/actions/unblock', { permission: 'customers:write', tags: C, summary: 'Allow online booking again', params: IdParams, status: 200 }, async (ctx, req) => customers.setBlocked(ctx, req.params.id, false));
  const Contact = Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }), email: Type.Optional(Type.Union([Type.String({ format: 'email' }), Type.Null()])), phone: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])), role: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])), is_primary: Type.Optional(Type.Boolean()) });
  const ContactParams = Type.Object({ id: Id, contact_id: Id });
  r.get('/customers/:id/contacts', { permission: 'customers:read', tags: C, summary: 'People at a company customer', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await customers.listContacts(ctx, req.params.id) }));
  r.post('/customers/:id/contacts', { permission: 'customers:write', tags: C, summary: 'Add a contact', params: IdParams, body: Contact }, async (ctx, req) => customers.saveContact(ctx, req.params.id, req.body));
  r.patch('/customers/:id/contacts/:contact_id', { permission: 'customers:write', tags: C, summary: 'Update a contact', params: ContactParams, body: Contact }, async (ctx, req) => customers.saveContact(ctx, req.params.id, req.body, req.params.contact_id));
  r.delete('/customers/:id/contacts/:contact_id', { permission: 'customers:write', tags: C, summary: 'Remove a contact', params: ContactParams }, async (ctx, req) => {
    await customers.deleteContact(ctx, req.params.id, req.params.contact_id);
  });
  r.post('/customers/:id/actions/anonymize', { permission: 'customers:write', tags: C, summary: 'GDPR erasure keeping financial records', params: IdParams, status: 200 }, async (ctx, req) => customers.anonymizeCustomer(ctx, req.params.id));
}
