/**
 * @openrent/plugin-sdk — the contract between OpenRent core and plugins (PRD §3.17, §7.7).
 * Licensed Apache-2.0 so plugin authors take on no AGPL obligations.
 */

export const PLUGIN_API_VERSION = '1.4.0';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

/** Context handed to providers. Config is the tenant's decrypted provider configuration. */
export interface ProviderContext {
  tenantId: string;
  config: Record<string, unknown>;
  logger: Logger;
  /** Idempotency key derived from the originating request, when there is one. */
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentPurpose = 'rental' | 'deposit' | 'damage' | 'late_fee';

export interface PaymentCustomer {
  id: string;
  name: string;
  email?: string | null;
  providerRef?: string | null;
}

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  orderId: string;
  orderNumber: number;
  purpose: PaymentPurpose;
  customer: PaymentCustomer;
  /** Save the payment method so a deposit can be authorised off-session later. */
  savePaymentMethod: boolean;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  ref: string;
  clientSecret: string | null;
  status: 'requires_payment' | 'processing' | 'succeeded' | 'requires_capture' | 'failed' | 'cancelled';
  customerRef?: string | null;
}

/** A provider-hosted page the customer pays on (FR-PAY-1). */
export interface PaymentLinkInput {
  amount: number;
  currency: string;
  orderId: string;
  orderNumber: number;
  description: string;
  customer: PaymentCustomer;
  /** Where the customer lands after paying, and after giving up. */
  successUrl: string;
  cancelUrl: string;
  expiresAt?: Date | null;
  /** Echoed back on the payment so it settles the right request (`payment_request_id`). */
  metadata?: Record<string, string>;
}

export interface PaymentLinkResult {
  ref: string;
  url: string;
  expiresAt: Date | null;
}

export interface AuthorizeInput {
  amount: number;
  currency: string;
  orderId: string;
  customerRef: string;
  paymentMethodRef: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface AuthorizeResult {
  ref: string;
  status: 'held' | 'requires_action' | 'failed';
  expiresAt: Date | null;
  error?: string;
}

export interface CaptureResult {
  status: 'captured' | 'partially_captured' | 'failed';
  amountCaptured: number;
}

export interface RefundResult {
  ref: string;
  status: 'succeeded' | 'pending' | 'failed';
}

/** Extra Content-Security-Policy sources, per directive, e.g. `{ script: ['https://js.stripe.com'] }`. */
export interface CspSources {
  script?: string[];
  frame?: string[];
  connect?: string[];
  img?: string[];
  style?: string[];
}

/** Provider-independent event produced by handleWebhook. */
export type ProviderEvent =
  | {
      type: 'payment.succeeded';
      eventId: string;
      ref: string;
      amount: number;
      currency: string;
      orderId: string | null;
      purpose: PaymentPurpose;
      customerRef?: string | null;
      paymentMethodRef?: string | null;
      /** The payment request this payment settles, when the intent was created for one. */
      paymentRequestId?: string | null;
    }
  | { type: 'payment.failed'; eventId: string; ref: string; orderId: string | null; error: string }
  | { type: 'payment.cancelled'; eventId: string; ref: string; orderId: string | null }
  | {
      type: 'authorization.held';
      eventId: string;
      ref: string;
      amount: number;
      orderId: string | null;
      expiresAt: Date | null;
    }
  | { type: 'refund.succeeded'; eventId: string; ref: string; paymentRef: string; amount: number }
  | { type: 'ignored'; eventId: string; providerType: string };

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface PaymentProvider {
  id: string;
  displayName: string;
  /** Days a card authorisation stays valid with this provider (deposit expiry policy, FR-PAY-5). */
  authorizationWindowDays: number;
  isConfigured(ctx: ProviderContext): boolean;
  /** Values safe to hand to a browser (e.g. a publishable key). */
  publicConfig(ctx: ProviderContext): Record<string, unknown>;
  /** Origins the storefront's Content-Security-Policy must allow for this provider's browser code (FR-THM-7). */
  cspSources?(ctx: ProviderContext): CspSources;
  createPaymentIntent(ctx: ProviderContext, input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  /** A hosted payment page; without it, customers pay on the shop's own order page. */
  createPaymentLink?(ctx: ProviderContext, input: PaymentLinkInput): Promise<PaymentLinkResult>;
  authorize(ctx: ProviderContext, input: AuthorizeInput): Promise<AuthorizeResult>;
  capture(ctx: ProviderContext, ref: string, amount: number): Promise<CaptureResult>;
  void(ctx: ProviderContext, ref: string): Promise<void>;
  refund(ctx: ProviderContext, ref: string, amount: number): Promise<RefundResult>;
  handleWebhook(ctx: ProviderContext, req: WebhookRequest): Promise<ProviderEvent>;
  /**
   * Current state of a payment as an event, used when the customer returns from the payment page
   * before the webhook arrives. Event ids must be stable per state so replays are ignored.
   */
  retrievePayment?(ctx: ProviderContext, ref: string): Promise<ProviderEvent>;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface Attachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Attachment[];
  /** Extra headers, e.g. a message id the bounce handler can match. */
  headers?: Record<string, string>;
}

export type DeliveryErrorCode =
  | 'not_configured'
  | 'tls_mismatch'
  | 'certificate'
  | 'auth_failed'
  | 'connection_failed'
  | 'host_not_found'
  | 'timeout'
  | 'recipient_rejected'
  | 'rejected';

/**
 * Thrown by notification channels so core can explain a failure. `permanent` failures (the server
 * refused this recipient or message) are not retried; anything else is retried with backoff.
 */
export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode;
  readonly permanent: boolean;
  constructor(code: DeliveryErrorCode, message: string, opts: { permanent?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'DeliveryError';
    this.code = code;
    this.permanent = opts.permanent ?? false;
  }
}

export interface NotificationChannel {
  id: string;
  channel: 'email' | 'sms';
  isConfigured(ctx: ProviderContext): boolean;
  send(ctx: ProviderContext, msg: OutgoingMessage): Promise<{ ref: string | null }>;
  /**
   * Delivery reports from the provider (FR-NOT-5), posted to /webhooks/notify/{plugin}/{tenant}.
   * Returns one entry per message the report is about; throw with `status: 401` for a bad signature.
   */
  handleWebhook?(ctx: ProviderContext, req: WebhookRequest): Promise<DeliveryReport[]>;
}

export interface DeliveryReport {
  ref: string;
  status: 'delivered' | 'bounced' | 'complained';
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Object storage for files (PDFs, uploads). Without one, files are kept in the database. */
export interface StorageProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  put(ctx: ProviderContext, key: string, body: Buffer, contentType: string): Promise<void>;
  get(ctx: ProviderContext, key: string): Promise<Buffer>;
  /** Deleting a missing key is not an error. */
  delete(ctx: ProviderContext, key: string): Promise<void>;
  /** Whether a key exists; throws when the store cannot be reached (used by readiness checks). */
  head?(ctx: ProviderContext, key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Tax, identity, search and signatures (plugin API 1.1)
// ---------------------------------------------------------------------------

export interface TaxRateRequest {
  currency: string;
  customer: { id: string | null; country: string | null; taxId: string | null; address: Record<string, unknown> | null } | null;
  /** Where the rental is picked up: the shop location. */
  origin: { country: string | null; address: Record<string, unknown> | null };
  lines: { key: string; type: string; productId: string | null; variantId: string | null; taxCode: string | null; defaultRateBp: number }[];
}

/**
 * Tax rates from an outside service (FR-PLG-1). OpenRent asks for one rate per line before pricing; the
 * pricing engine itself stays the same. Lines left out keep the shop's own tax profile.
 */
export interface TaxProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  rates(ctx: ProviderContext, req: TaxRateRequest): Promise<Record<string, number>>;
}

export interface IdentityCheckResult {
  status: 'verified' | 'pending' | 'failed';
  ref?: string | null;
  /** Where the customer completes the check, when it is still pending. */
  url?: string | null;
}

/** Identity checks for customers marked "requires ID check": pickup waits until the check passes. */
export interface IdentityProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  check(ctx: ProviderContext, req: { customer: { id: string; name: string; email: string | null }; orderId: string | null }): Promise<IdentityCheckResult>;
}

/** Product search for the storefront; returns product ids, best match first. Without one, OpenRent searches itself. */
export interface SearchProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  search(ctx: ProviderContext, req: { q: string; locale: string | null; limit: number }): Promise<string[]>;
}

/** Electronic signatures on issued documents (filled by the built-in provider or a plugin). */
export interface SignatureProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  requestSignature(ctx: ProviderContext, req: { documentId: string; documentUrl: string; signer: { name: string; email: string } }): Promise<{ ref: string; url: string | null }>;
  status?(ctx: ProviderContext, ref: string): Promise<'pending' | 'signed' | 'declined'>;
}

// ---------------------------------------------------------------------------
// Integrations (plugin API 1.2): connections to other systems
// ---------------------------------------------------------------------------

/** What kind of system an integration connects to; core supplies data for some kinds (accounting). */
export type IntegrationCategory = 'accounting' | 'calendar' | 'crm' | 'marketing' | 'messaging' | 'other';

/**
 * How a shop connects. OAuth 2 runs the authorization code flow with PKCE in core; the client id and
 * secret come from the plugin's settings (`clientIdSetting`, `clientSecretSetting`). With `fields` the
 * shop types its credentials (an API key) on the integrations page.
 */
/**
 * How a shop signs in to the other system. In `authorizeUrl` and `tokenUrl`, `{key}` is replaced by the
 * plugin setting `key` (plugin API 1.3), e.g. `https://accounts.zoho.{data_center}/oauth/v2/auth`.
 */
export type IntegrationAuth =
  | {
      type: 'oauth2';
      authorizeUrl: string;
      tokenUrl: string;
      scopes: string[];
      clientIdSetting: string;
      clientSecretSetting: string;
      /** Extra query parameters for the authorize URL. */
      authorizeParams?: Record<string, string>;
      /** How the token endpoint wants the app's credentials: HTTP Basic (default) or in the form body (1.3). */
      clientAuth?: 'basic' | 'body';
      /** The word before the access token in the Authorization header; default `Bearer` (1.3). */
      tokenPrefix?: string;
      /**
       * A plugin setting that, when it holds an http(s) URL, replaces the origin of both OAuth URLs
       * (plugin API 1.4). For sandboxes and test servers; shops leave it empty.
       */
      baseUrlSetting?: string;
    }
  | { type: 'fields'; fields: SettingsField[] };

/** A neutral accounting contact (a customer). */
export interface AccountingContact {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } | null;
}

/** What a line is, so it can be booked to the right account. */
export type AccountingLineKind = 'rental' | 'sale' | 'service' | 'fee' | 'damage' | 'late_fee' | 'discount' | 'other';

export interface AccountingLine {
  description: string;
  quantity: number;
  /** Net amount per unit, in minor units. */
  unit_amount: number;
  /** Net total of the line after discounts, in minor units. */
  net_amount: number;
  tax_amount: number;
  tax_rate_bp: number;
  kind: AccountingLineKind;
}

/** An issued invoice or credit note, as the books need it. Amounts are in minor units. */
export interface AccountingInvoice {
  id: string;
  type: 'invoice' | 'credit_note';
  number: string;
  issued_at: string;
  due_at: string | null;
  currency: string;
  contact: AccountingContact;
  order_number: number | null;
  lines: AccountingLine[];
  net_total: number;
  tax_total: number;
  total: number;
  /** For a credit note: the invoice it reverses. */
  credit_for: { id: string; number: string } | null;
  /** Payments on the order (not deposits), oldest first: some may have reached the books before the invoice (plugin API 1.4). */
  order_payments: { id: string; amount: number }[];
  status: 'issued' | 'sent' | 'voided';
}

/** Money received or paid back, against an order's latest invoice. */
export interface AccountingPayment {
  id: string;
  kind: 'payment' | 'refund';
  /** Deposits are held money, not revenue: most books keep them on a liability account. */
  purpose: 'rental' | 'deposit' | 'damage' | 'late_fee';
  amount: number;
  currency: string;
  paid_at: string;
  method: string | null;
  provider: string | null;
  /** The invoice it settles, when the order has one. */
  invoice_id: string | null;
  order_number: number | null;
}

/** A booking as other systems need it (plugin API 1.3). Amounts are in minor units. */
export interface IntegrationOrder {
  id: string;
  number: number;
  status: string;
  /** Where it was booked: `admin`, `storefront`, `widget` or `api`. */
  source: string;
  currency: string;
  total: number;
  balance: number;
  starts_at: string;
  ends_at: string;
  created_at: string;
  contact: AccountingContact | null;
  location: { id: string; name: string };
  lines: { description: string; quantity: number; total: number; product_id: string | null }[];
}

export type AccountingEntryKind =
  | 'invoice' | 'credit_note' | 'invoice_void' | 'payment' | 'refund'
  | 'deposit_received' | 'deposit_returned' | 'deposit_applied' | 'damage_revenue';

/**
 * A booked accounting entry (plugin API 1.4, ADR 0009): balanced, numbered, never changed. Invoices,
 * credit notes and payments point to their source record; a reversal points to the entry it undoes.
 * Amounts are in minor units.
 */
export interface AccountingEntry {
  id: string;
  number: number;
  kind: AccountingEntryKind;
  date: string;
  currency: string;
  total: number;
  reference: string;
  source: { type: 'document' | 'payment' | 'entry'; id: string };
  /** For a reversal: the entry it undoes, with that entry's own source. */
  reverses: { id: string; kind: AccountingEntryKind; source: { type: string; id: string } } | null;
  contact: AccountingContact | null;
  /** `account_key` is OpenRent's (receivable, cash, deposits, revenue_rental…); providers map it. */
  lines: { account_key: string; debit: number; credit: number; tax_rate_bp: number | null; description: string }[];
}

/** Records of the other system a shop maps OpenRent's accounts and taxes to (plugin API 1.4). */
export interface LookupItem {
  id: string;
  name: string;
  code?: string;
  /** The other system's account type (REVENUE, BANK, CURRLIAB…). */
  type?: string;
  /** For tax rates, in basis points (2000 = 20 %). */
  rateBp?: number;
}

export interface IntegrationLookups {
  accounts?: LookupItem[];
  taxRates?: LookupItem[];
  items?: LookupItem[];
  paymentAccounts?: LookupItem[];
  /** Currencies the organisation can invoice in. */
  currencies?: string[];
}

/**
 * One choice the shop makes on the mapping screen (plugin API 1.4): which remote account, item or
 * payment account an OpenRent account key stands for. Stored in the connection's settings under
 * `mapping[key]`; read it with `mapped(ctx, key)`.
 */
export interface MappingSlot {
  /** `accounts.<account key>`, `items.<line kind>` or `payment_accounts.<account key>`. */
  key: string;
  list: 'accounts' | 'items' | 'paymentAccounts';
  /** Remote types that fit (e.g. REVENUE, SALES); empty means any. */
  types?: string[];
  required?: boolean;
}

/** A payment recorded in the other system against an invoice OpenRent sent (plugin API 1.4). */
export interface RemotePayment {
  remoteId: string;
  invoiceRemoteId: string;
  /** Minor units. */
  amount: number;
  currency: string;
  date: string;
  reference?: string;
}

/** What the other system holds now for a record OpenRent sent, for reconciliation (plugin API 1.4). */
export interface RemoteRecord {
  remoteId: string;
  /** Minor units; null when the record is gone. */
  total: number | null;
  status: 'open' | 'paid' | 'voided' | 'deleted' | 'draft' | 'other';
}

/** Throw to try a task again after the other system's own wait (HTTP 429 Retry-After). */
export class RetryLater extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RetryLater';
    this.retryAfterMs = retryAfterMs;
  }
}

/** The remote id the shop mapped to `key` (e.g. `accounts.revenue_rental`), or null. */
export function mapped(ctx: { connection: { settings: Record<string, unknown> } }, key: string): string | null {
  const v = (ctx.connection.settings.mapping as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'string' && v ? v : null;
}

/** Core data an integration may read, by category. */
export interface IntegrationData {
  accounting: {
    contact(customerId: string): Promise<AccountingContact | null>;
    invoice(documentId: string): Promise<AccountingInvoice | null>;
    payment(paymentId: string): Promise<AccountingPayment | null>;
    /** A booked entry (plugin API 1.4). */
    entry(entryId: string): Promise<AccountingEntry | null>;
  };
  /** A customer as a contact (plugin API 1.3). */
  contact(customerId: string): Promise<AccountingContact | null>;
  /** A booking with its customer (plugin API 1.3). */
  order(orderId: string): Promise<IntegrationOrder | null>;
}

/** One piece of work: an OpenRent event to bring across, run with retries until it succeeds. */
export interface IntegrationTask {
  id: string;
  /** The event type, e.g. `document.issued`, or `sync.<type>` for a catch-up run. */
  event: string;
  object: { type: string; id: string };
  attempt: number;
}

export interface IntegrationContext extends ProviderContext {
  connection: { id: string; settings: Record<string, unknown>; account: Record<string, unknown> };
  /** What the shop typed for `fields` auth (an API key…); empty for OAuth 2, whose token `fetch` adds. */
  credentials: Record<string, string>;
  /** `fetch` with the connection's credentials; an expired OAuth token is refreshed first. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean; json(): Promise<any>; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
  /** Which record in the other system an OpenRent record became. */
  links: {
    get(localType: string, localId: string): Promise<{ remoteId: string; extra: Record<string, unknown> } | null>;
    set(localType: string, localId: string, remoteId: string, extra?: Record<string, unknown>): Promise<void>;
  };
  data: IntegrationData;
}

export interface IntegrationResult {
  status: 'done' | 'skipped';
  /** Shown in the sync log, e.g. "Invoice INV-1042 sent". */
  message?: string;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  category: IntegrationCategory;
  auth: IntegrationAuth;
  /** Event types this integration brings across; each one becomes a task per connected shop. */
  events: string[];
  /** Options the shop sets on the connection (account codes, calendars…). */
  settings?: SettingsField[];
  /**
   * Right after connecting: checks the credentials and returns details to keep (the organisation's
   * name and ids). `params` carries extra values the provider sent back (e.g. QuickBooks' realmId).
   */
  onConnected?(ctx: IntegrationContext, params: Record<string, string>): Promise<{ accountName?: string; account?: Record<string, unknown> }>;
  /** Brings one task across. Throw to retry later; the message goes to the sync log. */
  handle(ctx: IntegrationContext, task: IntegrationTask): Promise<IntegrationResult>;
  /**
   * Accounting systems (plugin API 1.4). `lookups` lists the organisation's accounts, tax rates, items
   * and payment accounts; `mapping` names the choices the shop must make from them; with `mapsTaxes`
   * each tax rate the shop uses maps to a remote tax rate (`mapping['taxes.<rate bp>']`).
   */
  lookups?(ctx: IntegrationContext): Promise<IntegrationLookups>;
  mapping?: MappingSlot[];
  mapsTaxes?: boolean;
  /** Organisations the sign-in gave access to, when there can be several (plugin API 1.4). */
  organisations?(ctx: IntegrationContext): Promise<{ id: string; name: string }[]>;
  /** Switches the connection to one of `organisations`; returns what to keep, like `onConnected`. */
  useOrganisation?(ctx: IntegrationContext, id: string): Promise<{ accountName?: string; account?: Record<string, unknown> }>;
  /** Payments recorded in the other system since `since` (ISO), for invoices OpenRent sent (plugin API 1.4). */
  pullPayments?(ctx: IntegrationContext, since: string): Promise<RemotePayment[]>;
  /** What the other system holds now for records OpenRent sent (plugin API 1.4). */
  check?(ctx: IntegrationContext, records: { localType: string; remoteId: string }[]): Promise<RemoteRecord[]>;
  /** A link to a sent record in the other system's web app, or null (plugin API 1.4). */
  remoteUrl?(localType: string, remoteId: string, account: Record<string, unknown>): string | null;
}

// ---------------------------------------------------------------------------
// Hooks and events
// ---------------------------------------------------------------------------

export type HookName =
  | 'orders.transition'
  | 'orders.create'
  | 'pricing.quote'
  | 'documents.render'
  | 'availability.check'
  | 'payments.record'
  /** Before a storefront order is placed; payload has the checkout's `extra` field values. Veto to refuse. */
  | 'checkout.complete';

export interface HookContext {
  tenantId: string;
  actor: { type: string; id: string | null };
  logger: Logger;
  /** This plugin's own view of the shop: guarded database access, read services, secrets and events. */
  scope?: PluginScope;
  /** Set by OpenRent; the host turns it into `scope` for each plugin. */
  scopeFor?: (pluginId: string) => PluginScope;
}

/**
 * What a plugin can reach while handling a hook, route or schedule (FR-PLG-3). These are guard rails,
 * not a sandbox: plugins run in the same process and an installed plugin is trusted code.
 */
export interface PluginScope {
  /**
   * The shop's data under its row-level security. Reads may touch any table; writes only the plugin's
   * own `plg_<id>_` tables. Session settings, roles and schema changes are refused.
   */
  db: { query<T = any>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };
  /** Read-only views of core records, in the shape the REST API returns. */
  services: {
    getOrder(id: string): Promise<unknown>;
    getCustomer(id: string): Promise<unknown>;
    getProduct(id: string): Promise<unknown>;
  };
  /** The plugin's settings for this shop, secret ones decrypted. */
  config(): Promise<Record<string, unknown>>;
  secrets: { get(key: string): Promise<string | null> };
  /** Emits `plugin.<id>.<name>` events to webhooks and other plugins; other names are refused. */
  events: { emit(type: string, object: Record<string, unknown>): Promise<void> };
}

export type ScheduleHandler = (ctx: HookContext) => void | Promise<void>;

/** SQL a plugin runs once per installation, in name order, after OpenRent's own migrations. */
export interface PluginMigration {
  name: string;
  /** Only statements on the plugin's own `plg_<id>_` tables and indexes are accepted. */
  sql: string;
}

export type HookHandler<P = any> = (payload: P, ctx: HookContext) => void | Promise<void>;

/** Throw from a `before` hook to deliberately block an operation. Any other error is logged and ignored. */
export class HookVeto extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HookVeto';
  }
}

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  api_version: string;
  created_at: string;
  tenant_id: string;
  livemode: boolean;
  data: { object: T; previous_attributes?: Record<string, unknown> };
  request?: { id?: string | null; idempotency_key?: string | null };
  actor: { type: string; id: string | null };
}

export type EventHandler = (event: DomainEvent, ctx: HookContext) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Routes and admin slots
// ---------------------------------------------------------------------------

export interface PluginRouteRequest {
  tenantId: string;
  actor: { type: string; id: string | null };
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path below /api/v1/plugins/{plugin id}. */
  path: string;
  permission?: string;
  handler(req: PluginRouteRequest, ctx: HookContext): Promise<unknown>;
}

export type AdminSlot =
  | 'order.sidebar'
  | 'order.actions'
  | 'product.tab'
  | 'customer.tab'
  | 'dashboard.widget'
  | 'settings.page'
  | 'nav.item'
  | 'scan.mode';

/** Text in several languages, e.g. `{ en: 'Gate code', de: 'Torcode' }`; English is the fallback. */
export type LocalizedText = Record<string, string>;

/** An extra field on the storefront checkout (FR-PLG-5); its value is stored on the order. */
export interface CheckoutField {
  key: string;
  label: LocalizedText;
  type: 'text' | 'checkbox' | 'select';
  required?: boolean;
  options?: { value: string; label: LocalizedText }[];
  help?: LocalizedText;
}

/** A label shown on storefront products that carry `tag`. */
export interface ProductBadge {
  tag: string;
  label: LocalizedText;
  tone?: 'default' | 'success' | 'warning';
}

/** A script the storefront loads, only after the visitor agreed to its consent category. */
export interface StorefrontScript {
  src: string;
  consent: 'necessary' | 'analytics' | 'marketing';
}

/** Declarative storefront extensions: data only, rendered by the storefront itself (FR-PLG-5). */
export interface StorefrontExtensions {
  checkoutFields?: CheckoutField[];
  productBadges?: ProductBadge[];
  scripts?: StorefrontScript[];
}

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'boolean' | 'select' | 'number';
  options?: string[];
  required?: boolean;
  help?: string;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export interface PluginSetupApi {
  logger: Logger;
  registerPaymentProvider(p: PaymentProvider): void;
  registerNotificationChannel(c: NotificationChannel): void;
  registerStorageProvider(s: StorageProvider): void;
  registerTaxProvider(p: TaxProvider): void;
  registerIdentityProvider(p: IdentityProvider): void;
  registerSearchProvider(p: SearchProvider): void;
  registerSignatureProvider(p: SignatureProvider): void;
  /** A connection to another system (plugin API 1.2), shown on the admin's Integrations page. */
  registerIntegration(p: IntegrationProvider): void;
  /** Runs `handler` on a cron schedule (UTC) once for every shop that has the plugin turned on. */
  schedule(name: string, cron: string, handler: ScheduleHandler): void;
  before<P = any>(hook: HookName, handler: HookHandler<P>): void;
  after<P = any>(hook: HookName, handler: HookHandler<P>): void;
  on(eventType: string, handler: EventHandler): void;
  route(route: PluginRoute): void;
  /**
   * An admin extension: `bundleUrl` defines the custom element `element` (default `<plugin id>-<slot>`,
   * e.g. `loyalty-order-sidebar`), which the admin places in `slot` with a `context` property.
   */
  adminSlot(slot: AdminSlot, bundleUrl: string, element?: string): void;
  storefront(ext: StorefrontExtensions): void;
  /** Environment lookup for installation-level defaults (self-hosters). */
  env(name: string): string | undefined;
  /** Installation-level defaults; per-tenant config stored in the database overrides them. */
  setDefaultConfig(config: Record<string, unknown>): void;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  license?: string;
  /** Semver range of the plugin API this plugin supports. */
  compat: string;
  permissions?: string[];
  settings?: SettingsField[];
  /** Translation catalogues for admin texts, by language (`{ en: { "key": "text" } }`). */
  locales?: Record<string, Record<string, string>>;
  /** Admin extension bundles (custom elements) by slot; files are relative to the plugin folder. */
  admin?: { slot: AdminSlot; file: string; element?: string }[];
  migrations?: PluginMigration[];
  /** Schedules the plugin declares, for the plugins page; handlers are registered with `api.schedule`. */
  jobs?: { name: string; cron: string }[];
}

export interface PluginDefinition extends PluginManifest {
  setup(api: PluginSetupApi): void | Promise<void>;
}

export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}

// ---------------------------------------------------------------------------
// Runtime seen by core
// ---------------------------------------------------------------------------

export interface PluginRuntime {
  paymentProvider(id: string): PaymentProvider | undefined;
  paymentProviders(): PaymentProvider[];
  notificationChannel(channel: 'email' | 'sms'): NotificationChannel | undefined;
  /** Every channel of this kind, in load order (a shop picks one). */
  notificationChannels(channel: 'email' | 'sms'): NotificationChannel[];
  storageProvider(): StorageProvider | undefined;
  taxProvider(): TaxProvider | undefined;
  identityProvider(): IdentityProvider | undefined;
  searchProvider(): SearchProvider | undefined;
  signatureProvider(): SignatureProvider | undefined;
  integrations(): IntegrationProvider[];
  integration(id: string): IntegrationProvider | undefined;
  runHook(phase: 'before' | 'after', name: HookName, payload: unknown, ctx: HookContext): Promise<void>;
  dispatch(event: DomainEvent, ctx: HookContext): Promise<void>;
  /** Storefront extensions declared by plugins, in load order. */
  storefrontExtensions(): { pluginId: string; ext: StorefrontExtensions }[];
  /** Installation-level default config a plugin registered (usually from env); tenant config overrides it. */
  defaultConfig(pluginId: string): Record<string, unknown>;
  /** Which plugin registered a provider or channel. */
  pluginIdOf(providerId: string): string | undefined;
}

/** A runtime with nothing registered; used by tests and tools. */
export const emptyRuntime: PluginRuntime = {
  paymentProvider: () => undefined,
  paymentProviders: () => [],
  notificationChannel: () => undefined,
  notificationChannels: () => [],
  storageProvider: () => undefined,
  taxProvider: () => undefined,
  identityProvider: () => undefined,
  searchProvider: () => undefined,
  signatureProvider: () => undefined,
  integrations: () => [],
  integration: () => undefined,
  runHook: async () => undefined,
  dispatch: async () => undefined,
  storefrontExtensions: () => [],
  defaultConfig: () => ({}),
  pluginIdOf: () => undefined,
};

export { validateManifest, ADMIN_SLOTS, PLUGIN_PERMISSIONS, type ManifestCheck } from './manifest.ts';
