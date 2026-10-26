/**
 * @openrent/plugin-sdk — the contract between OpenRent core and plugins (PRD §3.17, §7.7).
 * Licensed Apache-2.0 so plugin authors take on no AGPL obligations.
 */

export const PLUGIN_API_VERSION = '1.1.0';

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
  runHook: async () => undefined,
  dispatch: async () => undefined,
  storefrontExtensions: () => [],
  defaultConfig: () => ({}),
  pluginIdOf: () => undefined,
};

export { validateManifest, ADMIN_SLOTS, PLUGIN_PERMISSIONS, type ManifestCheck } from './manifest.ts';
