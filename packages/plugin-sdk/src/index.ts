/**
 * @openrent/plugin-sdk — the contract between OpenRent core and plugins (PRD §3.17, §7.7).
 * Licensed Apache-2.0 so plugin authors take on no AGPL obligations.
 */

export const PLUGIN_API_VERSION = '1.10.0';

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
  /**
   * The shop's URL for this provider's webhooks, for providers that are told it per request: payment
   * providers (plugin API 1.5) and text message channels, for delivery reports (1.6).
   */
  webhookUrl?: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** `invoice`: a customer invoice that belongs to no booking, such as a membership fee (plugin API 1.9). */
export type PaymentPurpose = 'rental' | 'deposit' | 'damage' | 'late_fee' | 'invoice';

export interface PaymentCustomer {
  id: string;
  name: string;
  email?: string | null;
  providerRef?: string | null;
}

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  /**
   * The booking paid for. Null for a customer invoice without one (plugin API 1.9); then `reference`
   * names the invoice, for descriptions and idempotency keys.
   */
  orderId: string | null;
  orderNumber: number | null;
  /** Unique per thing paid for: the order id, or the invoice id when there is no order (plugin API 1.9). */
  reference: string;
  purpose: PaymentPurpose;
  customer: PaymentCustomer;
  /** Save the payment method so a deposit can be authorised off-session later. */
  savePaymentMethod: boolean;
  description?: string;
  metadata?: Record<string, string>;
  /** The booking's page, where a provider that pays on its own page sends the customer back (plugin API 1.5). */
  returnUrl?: string;
}

export interface PaymentIntentResult {
  ref: string;
  /** For a payment form embedded in the storefront (Stripe Payment Element). */
  clientSecret: string | null;
  status: 'requires_payment' | 'processing' | 'succeeded' | 'requires_capture' | 'failed' | 'cancelled';
  customerRef?: string | null;
  /** For a provider that pays on its own page: where to send the customer (plugin API 1.5). */
  redirectUrl?: string | null;
}

/** A provider-hosted page the customer pays on (FR-PAY-1). */
export interface PaymentLinkInput {
  amount: number;
  currency: string;
  /** Null for a customer invoice without a booking (plugin API 1.9); see `reference`. */
  orderId: string | null;
  orderNumber: number | null;
  /** The order id, or the invoice id when there is no order (plugin API 1.9). */
  reference: string;
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
  /** Null when a saved card pays a customer invoice without a booking (plugin API 1.9); see `reference`. */
  orderId: string | null;
  /** The order id, or the invoice id when there is no order (plugin API 1.9). */
  reference?: string;
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
  /** `POST`, or `GET` for providers that report by query string; then `query` holds it (plugin API 1.6). */
  method?: string;
  query?: string;
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

/**
 * A message to send. Email has a subject and HTML. Text messages (`sms`, `whatsapp`, plugin API 1.6)
 * go to an E.164 number (`+3725551234`) with the message in `text`; subject and html are empty, and
 * `template` names the notification so a channel can pick a pre-approved WhatsApp template.
 */
export interface OutgoingMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  template?: string;
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

export type MessageChannelKind = 'email' | 'sms' | 'whatsapp';

export interface NotificationChannel {
  id: string;
  /** `whatsapp` from plugin API 1.6. */
  channel: MessageChannelKind;
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
  /** `failed`: a text message the network could not deliver (plugin API 1.6). */
  status: 'delivered' | 'bounced' | 'complained' | 'failed';
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
  customer: {
    id: string | null;
    country: string | null;
    taxId: string | null;
    address: Record<string, unknown> | null;
    /** The last check of `taxId` this provider made, kept on the customer (plugin API 1.8). */
    taxIdCheck?: TaxIdCheck | null;
  } | null;
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
  /** Rates by line key; or (plugin API 1.8) with a note the documents print, e.g. for the reverse charge. */
  rates(ctx: ProviderContext, req: TaxRateRequest): Promise<Record<string, number> | TaxRates>;
  /**
   * Checks a customer's tax number (plugin API 1.8): when it is saved, at checkout and on request.
   * `fresh` asks the register again instead of a kept answer (staff checking again).
   */
  checkTaxId?(ctx: ProviderContext, taxId: string, opts?: { fresh?: boolean }): Promise<TaxIdCheck>;
}

export interface TaxRates {
  rates: Record<string, number>;
  /** Printed under the totals of quotes and invoices, in the document's language. */
  note?: LocalizedText;
}

/**
 * The result of checking a tax number (plugin API 1.8). `unavailable` means the register could not
 * answer: the number is neither accepted nor refused, and tax is charged.
 */
export interface TaxIdCheck {
  status: 'valid' | 'invalid' | 'unavailable';
  /** ISO country of the number. */
  country: string | null;
  /** The registered name and address, when the register gives them. */
  name?: string | null;
  address?: string | null;
  /** The register's reference for this check (VIES consultation number). */
  ref?: string | null;
  checked_at: string;
  /** Why it is invalid or unavailable: `format`, or the register's own code. */
  reason?: string;
}

export interface IdentityCheckResult {
  status: 'verified' | 'pending' | 'failed';
  ref?: string | null;
  /** Where the customer completes the check, when it is still pending. */
  url?: string | null;
  /** Why a check failed, in the service's words (1.9). */
  reason?: string | null;
}

/**
 * Identity checks for customers marked "requires ID check": pickup waits until the check passes. A service
 * with its own verification page (Stripe Identity, Veriff) starts a session the customer completes and
 * reports back by webhook or `status` (plugin API 1.9).
 */
export interface IdentityProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  check(ctx: ProviderContext, req: { customer: { id: string; name: string; email: string | null }; orderId: string | null }): Promise<IdentityCheckResult>;
  /** Starts a verification session; the customer goes to `url` and comes back to `returnUrl` (1.9). */
  start?(ctx: ProviderContext, req: { customer: { id: string; name: string; email: string | null }; orderId: string | null; returnUrl: string; locale?: string | null }): Promise<{ ref: string; url: string }>;
  /** Where a session stands (1.9). */
  status?(ctx: ProviderContext, ref: string): Promise<IdentityCheckResult>;
  /** A webhook from the service at `ctx.webhookUrl` (1.9): which session changed, or null for anything else. */
  handleWebhook?(ctx: ProviderContext, req: WebhookRequest): Promise<{ ref: string; status: IdentityCheckResult['status']; reason?: string | null } | null>;
}

/** Product search for the storefront; returns product ids, best match first. Without one, OpenRent searches itself. */
export interface SearchProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  search(ctx: ProviderContext, req: { q: string; locale: string | null; limit: number }): Promise<string[]>;
}

/**
 * Exchange rates for showing prices in other currencies (plugin API 1.7, FR-I18N-7). `rates` returns
 * how much of each currency one unit of `base` buys; currencies it does not know are left out.
 */
export interface RatesProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  rates(ctx: ProviderContext, base: string, currencies: string[]): Promise<{ rates: Record<string, number>; date: string }>;
}

/**
 * Addresses on the map and the distance between them (plugin API 1.7, FR-PR-8), for delivery fees by
 * distance and route exports. `route` gives the road distance; without it, core uses a straight line
 * times the shop's road factor.
 */
export interface Geocoder {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  geocode(ctx: ProviderContext, address: string): Promise<{ lat: number; lon: number } | null>;
  route?(ctx: ProviderContext, from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<{ km: number } | null>;
}

/**
 * Electronic signatures on issued documents (filled by the built-in provider or a plugin). A service that
 * signs its own copy (Documenso, DocuSign) takes the PDF, reports back by webhook or `status`, and hands
 * over the signed PDF (plugin API 1.9).
 */
export interface SignatureProvider {
  id: string;
  isConfigured(ctx: ProviderContext): boolean;
  requestSignature(
    ctx: ProviderContext,
    req: {
      documentId: string;
      documentUrl: string;
      signer: { name: string; email: string };
      /** The document's title and number, for the signing service's email (1.9). */
      title?: string;
      /** The language of the signer (1.9). */
      locale?: string | null;
      /** The issued document as a PDF; null where the installation makes no PDFs (1.9). */
      pdf?: () => Promise<Uint8Array | null>;
    },
  ): Promise<{ ref: string; url: string | null }>;
  status?(ctx: ProviderContext, ref: string): Promise<'pending' | 'signed' | 'declined'>;
  /** A webhook from the service (1.9) at `ctx.webhookUrl`: which request changed, or null for anything else. */
  handleWebhook?(ctx: ProviderContext, req: WebhookRequest): Promise<{ ref: string; status: 'pending' | 'signed' | 'declined' } | null>;
  /** The signed PDF of a completed request (1.9). */
  signedPdf?(ctx: ProviderContext, ref: string): Promise<Uint8Array | null>;
}

// ---------------------------------------------------------------------------
// E-invoices (plugin API 1.9, FR-DOC-6)
// ---------------------------------------------------------------------------

/** A party of an e-invoice. Amounts elsewhere are minor units. */
export interface EInvoiceParty {
  name: string;
  legalName?: string | null;
  /** Registry code (e.g. an Estonian registrikood). */
  companyId?: string | null;
  vatId?: string | null;
  address: { lines: string[]; city?: string | null; postalCode?: string | null; country: string | null };
  /** Electronic address, e.g. a Peppol participant id `{ scheme: '0191', id: '10002345' }`. */
  endpoint?: { scheme: string; id: string } | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * An invoice line. `taxCategory` is the EN 16931 code: S standard, Z zero rated, E exempt, AE reverse
 * charge, O outside the scope of VAT.
 */
export interface EInvoiceLine {
  id: string;
  name: string;
  quantity: number;
  /** UN/ECE Recommendation 20 code: C62 (one), DAY, HUR. */
  unitCode: string;
  /** Before tax, after discounts. */
  netAmount: number;
  /** Net price of one unit, `netAmount / quantity`. */
  unitPrice: number;
  taxAmount: number;
  taxRateBp: number;
  taxCategory: 'S' | 'Z' | 'E' | 'AE' | 'O' | 'K' | 'G';
  period?: { start: string; end: string } | null;
}

/** An issued invoice or credit note in neutral form, for e-invoice formats (plugin API 1.9). Dates are YYYY-MM-DD. */
export interface EInvoiceData {
  type: 'invoice' | 'credit_note';
  number: string;
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  /** The buyer's reference for the invoice: their purchase order number, else the booking number. */
  buyerReference?: string | null;
  orderReference?: string | null;
  /** For a credit note: the invoice it credits. */
  precedingInvoice?: { number: string; issueDate: string } | null;
  period?: { start: string; end: string } | null;
  note?: string | null;
  paymentTerms?: string | null;
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  lines: EInvoiceLine[];
  taxBreakdown: { category: EInvoiceLine['taxCategory']; rateBp: number; taxable: number; tax: number; exemptionReason?: string | null }[];
  totals: { lineNet: number; taxExclusive: number; tax: number; taxInclusive: number; prepaid: number; payable: number };
  /** Where to pay: the shop's bank account. */
  payment?: { iban?: string | null; bic?: string | null; reference?: string | null } | null;
}

export type EInvoiceResult = { filename: string; contentType: string; content: string | Buffer } | { missing: string[] };

/**
 * An e-invoice format (plugin API 1.9): Peppol UBL, Factur-X, a national format. Customers whose billing
 * details name the format get their invoices and credit notes in it, with the email and on download.
 */
export interface EInvoiceFormat {
  id: string;
  name: LocalizedText;
  /** The format needs the buyer's electronic address (a Peppol ID); the billing details then ask for it. */
  endpoint: boolean;
  isConfigured(ctx: ProviderContext): boolean;
  /**
   * The file for one document, or what the invoice lacks (paths such as `buyer.endpoint`). `files.pdf()`
   * gives the invoice's own PDF, for formats that carry it (Factur-X).
   */
  render(ctx: ProviderContext, invoice: EInvoiceData, files: { pdf(): Promise<Uint8Array | null> }): Promise<EInvoiceResult> | EInvoiceResult;
}

/** One tag read: the EPC in hex, and when, by which antenna and how strongly, where the reader says. */
export interface TagRead {
  epc: string;
  read_at?: string | null;
  antenna?: number | null;
  rssi?: number | null;
}

/**
 * An RFID reader's message format (plugin API 1.10, FR-SCAN-7). A reader, or the bridge next to it, posts
 * batches of reads to the address OpenRent gives it; the format turns one batch into tag reads. Core
 * checks the reader's token, keeps the reads and maps tags to units.
 */
export interface TagReader {
  id: string;
  name: LocalizedText;
  /** `body` is the parsed JSON or form (else the text); `rawBody` the bytes as sent. */
  parse(req: { headers: Record<string, string | string[] | undefined>; body: unknown; rawBody: Buffer }): TagRead[];
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
/** An issued document as a PDF file (plugin API 1.5). */
export interface DocumentPdf {
  filename: string;
  contentType: 'application/pdf';
  body: Uint8Array;
}

export interface IntegrationData {
  accounting: {
    contact(customerId: string): Promise<AccountingContact | null>;
    invoice(documentId: string): Promise<AccountingInvoice | null>;
    payment(paymentId: string): Promise<AccountingPayment | null>;
    /** A booked entry (plugin API 1.4). */
    entry(entryId: string): Promise<AccountingEntry | null>;
    /**
     * The issued PDF of an invoice or credit note, to attach to the remote copy (plugin API 1.5). Null
     * when this install renders no PDFs.
     */
    documentPdf(documentId: string): Promise<DocumentPdf | null>;
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
  /** `fetch` with the connection's credentials; an expired OAuth token is refreshed first. Bodies may be bytes (plugin API 1.5). */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<{ status: number; ok: boolean; json(): Promise<any>; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
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
  /**
   * Invoices and payments for things that are no booking, such as a membership fee (plugin API 1.9,
   * ADR 0014). Only plugins that list the `billing` permission get it. Money goes through OpenRent's
   * own invoices and payments, so it is numbered, booked and refundable like any other.
   */
  billing?: PluginBilling;
}

/** A line of a customer invoice: an amount before tax, in minor units, at `tax_rate_bp` or the shop's default rate. */
export interface PluginInvoiceLine {
  description: string;
  amount: number;
  quantity?: number;
  tax_rate_bp?: number;
}

export interface PluginInvoiceBalance {
  id: string;
  number: string | null;
  status: string;
  total: { amount: number; currency: string };
  paid: { amount: number; currency: string };
  due: { amount: number; currency: string };
}

export interface PluginBilling {
  /**
   * Issues an invoice to a customer. With `key`, an invoice issued before with the same key comes back
   * instead of a second one, so a renewal that runs twice bills once. The `document.paid` event of the
   * invoice carries the key as `source_key`, with the plugin id in front (`<plugin id>:<key>`).
   */
  invoiceCustomer(customerId: string, input: { lines: PluginInvoiceLine[]; key?: string; period?: { from: string; to: string } | null }): Promise<{ id: string; number: string | null; total: { amount: number; currency: string } }>;
  /** What is owed on the invoice. */
  invoiceDue(invoiceId: string): Promise<PluginInvoiceBalance>;
  /** Asks for the money online: emails the customer a payment link (unless `notify` is false) and returns it. */
  requestPayment(invoiceId: string, opts?: { notify?: boolean; returnUrl?: string }): Promise<{ url: string | null }>;
  /** Charges the card the customer saved with an earlier online payment. */
  chargeSavedCard(invoiceId: string, key: string): Promise<'paid' | 'no_card' | 'declined'>;
  /** Voids an invoice with a credit note, e.g. a fee that is no longer owed. */
  voidInvoice(invoiceId: string, reason?: string): Promise<void>;
}

/**
 * Thrown by a plugin route to answer with an error (plugin API 1.9): 422 with field `errors` shows next to
 * the fields of an admin page form, other statuses as a message.
 */
export class PluginError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;
  readonly code: string;
  readonly errors?: { field: string; code: string; message: string }[];
  constructor(status: 400 | 403 | 404 | 409 | 422, code: string, message: string, errors?: { field: string; code: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.name = 'PluginError';
  }
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
/**
 * A script the storefront loads for a plugin, once the visitor's consent allows it (FR-PLG-5). From
 * plugin API 1.7, `src` and `attrs` may name plugin settings as `{setting}` (an id, a domain), and the
 * script is left out while `requires` is not set.
 */
export interface StorefrontScript {
  src: string;
  consent: 'necessary' | 'analytics' | 'marketing';
  /** `data-*` attributes for the script tag (plugin API 1.7). */
  attrs?: Record<string, string>;
  /** A plugin setting that must be set for the script to load (plugin API 1.7). */
  requires?: string;
  /** Origins the script sends to, added to the page's connect-src and img-src (plugin API 1.7). */
  connect?: string[];
}

/** Declarative storefront extensions: data only, rendered by the storefront itself (FR-PLG-5). */
/** A setting of a plugin section, in the theme section format (shown in Admin → Themes → Sections). */
export interface PluginSectionSetting {
  id: string;
  type: 'text' | 'textarea' | 'range' | 'checkbox' | 'select';
  label: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

/**
 * A home page section type a plugin adds (plugin API 1.7, FR-THM-12). Themes that declare the
 * `section.register` extension point offer it in their section editor. `render` returns HTML for one
 * section; it is cleaned like the shop's own HTML and must be quick, as it runs while the page loads.
 */
export interface PluginSection {
  /** Lowercase letters, digits and dashes; unique within the plugin. */
  type: string;
  name: LocalizedText;
  settings?: PluginSectionSetting[];
  /** `scope` (plugin API 1.9) reads the shop's data, e.g. the plugin's own tables. */
  render(ctx: ProviderContext & { locale: string; scope?: PluginScope }, settings: Record<string, unknown>): Promise<string> | string;
}

export interface StorefrontExtensions {
  checkoutFields?: CheckoutField[];
  productBadges?: ProductBadge[];
  scripts?: StorefrontScript[];
  /** Home page section types (plugin API 1.7). */
  sections?: PluginSection[];
  /** Panels in the customer's account (plugin API 1.9). */
  accountPanels?: AccountPanel[];
}

/**
 * A discount (or surcharge) a plugin adds to a customer's prices (plugin API 1.9), e.g. a member price.
 * It joins the shop's own price rules: on rental lines in scope, by priority, stacking like them.
 */
export interface PluginPriceRule {
  /** Unique within the plugin. */
  id: string;
  /** Shown in the price explanation, e.g. "Member price". */
  name: string;
  /** −1000 = 10 % off, 2500 = 25 % more. */
  adjustment_bp: number;
  stackable?: boolean;
  /** Lower runs first; the shop's rules default to 100. */
  priority?: number;
  product_ids?: string[];
  category_ids?: string[];
}

export interface PriceRuleSource {
  /** The rules for one quote; `customerId` is null for a shopper who is not signed in. Runs on every quote: keep it quick. */
  rules(ctx: HookContext, req: { customerId: string | null }): Promise<PluginPriceRule[]> | PluginPriceRule[];
}

/** A column of an admin page's table. */
export interface AdminPageColumn {
  key: string;
  label: LocalizedText;
  /** `money` reads `{ amount, currency }`; `badge` shows the value as a status. */
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'badge';
}

/** A field of an admin page's form; `money` is entered in major units and sent in minor units. */
export interface AdminPageField {
  key: string;
  label: LocalizedText;
  type: 'text' | 'textarea' | 'number' | 'money' | 'select' | 'boolean' | 'date';
  required?: boolean;
  help?: LocalizedText;
  options?: { value: string; label: LocalizedText }[];
  /** For a `select` whose choices are the shop's own data: a plugin route returning `{ data: [{ value, label }] }`. */
  optionsPath?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Only when creating; the edit form leaves it out. */
  createOnly?: boolean;
}

/** A button on each record: POST `{path}/{id}/actions/{key}`. */
export interface AdminPageAction {
  key: string;
  label: LocalizedText;
  /** Asked before the action runs. */
  confirm?: LocalizedText;
  destructive?: boolean;
  /** Shown only for records whose `field` is one of `in`. */
  when?: { field: string; in: string[] };
}

/**
 * A page of records a plugin keeps, drawn by the admin itself (plugin API 1.9), so it looks and works
 * like the rest of OpenRent. The records come from the plugin's own routes below `/api/v1/plugins/{id}`:
 * GET `path` returns `{ data: [...] }`, each with an `id`. On a customer page the list gets `?customer_id=`
 * and new records get `customer_id`.
 */
export interface AdminPage {
  key: string;
  title: LocalizedText;
  description?: LocalizedText;
  /** On its own page under Settings → Plugins, or as a card on each customer's page. */
  placement: 'settings' | 'customer';
  path: string;
  /** Needed to see the page; the routes check their own permissions too. */
  permission?: string;
  columns: AdminPageColumn[];
  /** With `create`, a form adds records (POST `path`); with `update`, it edits them (PATCH `path/{id}`). */
  form?: { fields: AdminPageField[]; create?: boolean; update?: boolean };
  /** Records can be deleted (DELETE `path/{id}`). */
  remove?: boolean;
  actions?: AdminPageAction[];
  /** Shown when there are no records. */
  empty?: LocalizedText;
}

/**
 * A panel in the signed-in customer's storefront account (plugin API 1.9), e.g. a membership card. The
 * storefront draws it as a card with `title`; `html` is its content, cleaned like the shop's own. Null
 * shows nothing for this customer.
 */
export interface AccountPanel {
  key: string;
  render(ctx: HookContext & { locale: string }, customer: { id: string; email: string | null }): Promise<{ title: string; html: string } | null> | { title: string; html: string } | null;
}

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'boolean' | 'select' | 'number';
  options?: string[];
  required?: boolean;
  help?: string;
  /** What the admin form shows before the shop saves a value (plugin API 1.8); the plugin applies it itself too. */
  default?: string | number | boolean;
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
  /** Exchange rates for prices shown in other currencies (plugin API 1.7). */
  registerRatesProvider(p: RatesProvider): void;
  /** Addresses on the map and distances (plugin API 1.7). */
  registerGeocoder(p: Geocoder): void;
  registerSignatureProvider(p: SignatureProvider): void;
  /** An e-invoice format (plugin API 1.9), e.g. Peppol UBL or Factur-X. */
  registerEInvoiceFormat(f: EInvoiceFormat): void;
  /** An RFID reader's message format (plugin API 1.10). */
  registerTagReader(r: TagReader): void;
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
  /** Discounts or surcharges on a customer's prices (plugin API 1.9). */
  priceRules(source: PriceRuleSource): void;
  /** A page of the plugin's records, drawn by the admin (plugin API 1.9). */
  adminPage(page: AdminPage): void;
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
  /**
   * False for a plugin each shop turns on itself in Settings → Plugins (plugin API 1.9), such as one that
   * changes prices or adds pages. Others are on until a shop turns them off.
   */
  enabledByDefault?: boolean;
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
  notificationChannel(channel: MessageChannelKind): NotificationChannel | undefined;
  /** Every channel of this kind, in load order (a shop picks one). */
  notificationChannels(channel: MessageChannelKind): NotificationChannel[];
  storageProvider(): StorageProvider | undefined;
  taxProvider(): TaxProvider | undefined;
  /** Every registered tax plugin, in load order (plugin API 1.8). */
  taxProviders(): TaxProvider[];
  identityProvider(): IdentityProvider | undefined;
  /** Every identity plugin, in load order (plugin API 1.9); a shop uses the first it has on and set up. */
  identityProviders?(): IdentityProvider[];
  searchProvider(): SearchProvider | undefined;
  /** Every exchange rate provider, in load order (a shop picks one). */
  ratesProviders(): RatesProvider[];
  geocoder(): Geocoder | undefined;
  signatureProvider(): SignatureProvider | undefined;
  /** Every signature plugin, in load order (plugin API 1.9); a shop uses the first it has on and set up. */
  signatureProviders?(): SignatureProvider[];
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
  /** The permissions a plugin's manifest lists (plugin API 1.9). */
  permissionsOf?(pluginId: string): string[];
  /** Whether a shop that never chose has the plugin on (plugin API 1.9). */
  enabledByDefault?(pluginId: string): boolean;
  /** Price rule sources of plugins (plugin API 1.9). */
  priceRuleSources?(): { pluginId: string; source: PriceRuleSource }[];
  /** Admin pages of plugins (plugin API 1.9). */
  adminPages?(): { pluginId: string; page: AdminPage }[];
  /** E-invoice formats of plugins (plugin API 1.9). */
  einvoiceFormats?(): { pluginId: string; format: EInvoiceFormat }[];
  /** RFID reader formats of plugins (plugin API 1.10). */
  tagReaders?(): { pluginId: string; reader: TagReader }[];
}

/** A runtime with nothing registered; used by tests and tools. */
export const emptyRuntime: PluginRuntime = {
  paymentProvider: () => undefined,
  paymentProviders: () => [],
  notificationChannel: () => undefined,
  notificationChannels: () => [],
  storageProvider: () => undefined,
  taxProvider: () => undefined,
  taxProviders: () => [],
  identityProvider: () => undefined,
  identityProviders: () => [],
  searchProvider: () => undefined,
  ratesProviders: () => [],
  geocoder: () => undefined,
  signatureProvider: () => undefined,
  signatureProviders: () => [],
  integrations: () => [],
  integration: () => undefined,
  runHook: async () => undefined,
  dispatch: async () => undefined,
  storefrontExtensions: () => [],
  defaultConfig: () => ({}),
  pluginIdOf: () => undefined,
  permissionsOf: () => [],
  enabledByDefault: () => true,
  priceRuleSources: () => [],
  adminPages: () => [],
  einvoiceFormats: () => [],
  tagReaders: () => [],
};

export { validateManifest, ADMIN_SLOTS, PLUGIN_PERMISSIONS, type ManifestCheck } from './manifest.ts';
