/**
 * Stand-ins for Xero, QuickBooks Online and Zoho Books that enforce each system's documented rules, for
 * testing accounting integrations without real accounts (ADR 0009). They need nothing but Node.
 */
export { startFake, round, type FakeServer, type FakeRequest, type FakeReply, type OAuthOptions } from './common.ts';
export { startXeroFake, xeroOrg, type XeroFake, type XeroOrg } from './xero.ts';
export { startQuickBooksFake, qboCompany, type QboFake, type QboCompany } from './quickbooks.ts';
export { startZohoFake, zohoOrg, type ZohoFake, type ZohoOrg } from './zoho.ts';
export { memoryContext, type MemoryData } from './context.ts';
