export interface CancellationTier {
  /** Applies when cancelling at least this many hours before the start. */
  hours_before: number;
  refund_pct: number;
}

export interface DepositPolicy {
  mode: 'auto' | 'none' | 'fixed' | 'percent';
  amount?: number;
  pct_bp?: number;
}

export interface PaymentTerms {
  upfront: 'full' | 'percent' | 'fixed';
  /** Basis points of the order total when upfront = percent (2500 = 25 %). */
  percent_bp: number;
  /** Minor units when upfront = fixed. */
  fixed_amount: number;
  /** The balance is requested this many days before pickup. */
  balance_due_days_before: number;
}

/** Accounts the shop's entries book to (ADR 0009). */
export const ACCOUNT_KEYS = [
  'receivable', 'bank', 'cash', 'card_clearing', 'deposits', 'tax',
  'revenue_rental', 'revenue_sale', 'revenue_fees', 'revenue_damage', 'revenue_other', 'discounts', 'rounding',
] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export interface TenantSettings {
  display_prices_including_tax: boolean;
  /** Per storefront language (FR-I18N-7): prices shown with tax (`incl`) or without (`excl`); others follow the setting above. */
  tax_display: Record<string, 'incl' | 'excl'>;
  /**
   * Other currencies the storefront can show prices in (FR-I18N-7); orders are always charged in the
   * shop's currency. `rates` are units per one unit of the shop's currency, typed in or kept up to
   * date by a rates plugin (`source`).
   */
  display_currencies: { currencies: string[]; rates: Record<string, number>; source: string; updated_at: string | null };
  quote_ttl_hours: number;
  quote_holds_stock: boolean;
  /** Minutes a storefront checkout holds stock while payment completes. */
  storefront_hold_minutes: number;
  late_grace_minutes: number;
  late_fees_enabled: boolean;
  /** With a damage waiver on the order the customer pays damage only up to this much in total (minor units; FR-PAY-8). */
  damage_waiver_excess: number;
  /** Pickup needs a damage waiver on the order or an insurance document on the order or customer (FR-PAY-8). */
  requires_waiver_or_insurance: boolean;
  /** Units come back as needing inspection when a checklist covers them, and go back into service once it passes (FR-MNT-3). */
  require_inspection_on_return: boolean;
  cancellation_policy: CancellationTier[];
  deposit_policy: DepositPolicy;
  /** How much of the rental is paid at booking; the rest is requested before pickup (FR-PAY-2). */
  payment_terms: PaymentTerms;
  /** Authorise card deposits this many days before pickup (cards hold ~7 days). */
  deposit_authorize_days_before: number;
  deposit_expiry_warning_days: number;
  /**
   * What happens to a card hold about to expire before the rental ends (FR-PAY-5): warn staff, place a
   * fresh hold, or charge the deposit (refunded on return).
   */
  deposit_expiry_policy: 'notify' | 'reauthorize' | 'convert_to_charge';
  /** How far ahead the low-availability check looks (days). */
  low_availability_days_ahead: number;
  storefront: {
    enabled: boolean;
    payment: 'stripe' | 'none';
    locales: string[];
    default_locale: string;
    show_unavailable: boolean;
  };
  /** Rental terms; `translations` holds the text in other storefront languages (falls back to `text`). */
  terms: { text: string; version: string; translations?: Record<string, string> };
  document_prefixes: Record<string, string>;
  staff_email: string | null;
  email_from: string | null;
  /** Plugin that sends the shop's email (FR-NOT-1); null picks the first one that is set up. */
  email_channel: string | null;
  /** Plugins that send booking updates by SMS and WhatsApp (FR-NOT-4); null sends none. */
  sms_channel: string | null;
  whatsapp_channel: string | null;
  /** Sites that embed the widget checkout (`https://example.com`); payments may only return to these (FR-SF-2). */
  widget_origins: string[];
  /** Live storefront theme. `settings` is the pre-0.2 store of the live theme's settings. */
  theme: { id: string; settings: Record<string, unknown> };
  /** Saved settings per installed theme, so switching themes keeps each one's customisation. */
  theme_settings: Record<string, Record<string, unknown>>;
  /** Tenant overrides of theme strings: theme id → locale → key → text (FR-THM-6). */
  theme_translations: Record<string, Record<string, Record<string, string>>>;
  /** The shop's home page layout per theme (theme API 1.3); missing means the theme's default. */
  theme_sections: Record<string, unknown[]>;
  /** Shop texts of a theme per storefront language: theme id → locale → overlay path → text. */
  theme_content_translations: Record<string, Record<string, Record<string, string>>>;
  /**
   * Accounting (FR-INT-3, ADR 0009): account codes for the shop's entries; the lock date (nothing is
   * booked on or before it); when OpenRent issues the invoice by itself (without one, the books show
   * payments but no revenue).
   */
  accounting: { accounts: Record<AccountKey, string>; locked_until: string | null; invoice_when: 'manual' | 'reserved' | 'checked_out' | 'closed' };
  /** One email to carts left with an email and items, after this many hours (FR-SF-9); off unless turned on. */
  cart_reminders: { enabled: boolean; after_hours: number };
  /** The shop's own CSS and header/footer HTML, cleaned on save (FR-SF-4). */
  storefront_code: { css: string; header_html: string; footer_html: string; translations?: Record<string, { header_html?: string; footer_html?: string }> };
  /**
   * What search engines and shared links show for the home page, and the picture shared when a page has
   * none of its own; `translations` holds the texts in other storefront languages.
   */
  seo: { title: string | null; description: string | null; image_url: string | null; translations?: Record<string, { title?: string | null; description?: string | null }> };
  /**
   * What customers may change themselves in their account (ADR 0012): cancel (else they ask) up to
   * `cancel_until_hours` before pickup, and move their dates (off, ask, or themselves) up to
   * `change_until_hours` before pickup. Refunds follow `cancellation_policy`.
   */
  self_service: { cancel: 'request' | 'self'; cancel_until_hours: number; change_dates: 'off' | 'request' | 'self'; change_until_hours: number };
  /** The storefront's own menus; an empty header menu leaves the theme's (the categories). */
  navigation: { header: NavItem[]; footer: NavItem[] };
}

/**
 * A menu link: a category, page or product by id (its name when `label` is empty), the home page,
 * search, or an address (`/path` or https://…). `translations` holds the label in other languages.
 */
export interface NavItem {
  kind: 'home' | 'search' | 'category' | 'page' | 'product' | 'url';
  target?: string | null;
  label?: string | null;
  translations?: Record<string, string>;
}
export const NAV_KINDS = ['home', 'search', 'category', 'page', 'product', 'url'] as const;
export const NAV_MAX = { header: 12, footer: 20 } as const;

export const DEFAULT_TERMS = `1. The renter is responsible for the equipment from pickup until return.
2. Equipment must be returned clean and in the condition it was received.
3. Late returns are charged at the regular rate for each extra period.
4. Damage or loss is charged at repair or replacement cost and may be captured from the deposit.`;

export const DEFAULT_SETTINGS: TenantSettings = {
  display_prices_including_tax: true,
  tax_display: {},
  display_currencies: { currencies: [], rates: {}, source: 'manual', updated_at: null },
  quote_ttl_hours: 48,
  quote_holds_stock: true,
  storefront_hold_minutes: 30,
  late_grace_minutes: 60,
  late_fees_enabled: true,
  damage_waiver_excess: 0,
  accounting: {
    accounts: {
      receivable: '1200', bank: '1000', cash: '1010', card_clearing: '1150', deposits: '2300', tax: '2200',
      revenue_rental: '4000', revenue_sale: '4010', revenue_fees: '4020', revenue_damage: '4030', revenue_other: '4090', discounts: '4900', rounding: '8990',
    },
    locked_until: null,
    invoice_when: 'manual',
  },
  requires_waiver_or_insurance: false,
  require_inspection_on_return: false,
  cancellation_policy: [
    { hours_before: 48, refund_pct: 100 },
    { hours_before: 24, refund_pct: 50 },
    { hours_before: 0, refund_pct: 0 },
  ],
  deposit_policy: { mode: 'auto' },
  payment_terms: { upfront: 'full', percent_bp: 3000, fixed_amount: 0, balance_due_days_before: 7 },
  deposit_authorize_days_before: 1,
  deposit_expiry_warning_days: 1,
  deposit_expiry_policy: 'notify',
  low_availability_days_ahead: 7,
  storefront: { enabled: true, payment: 'none', locales: ['en'], default_locale: 'en', show_unavailable: true },
  terms: { text: DEFAULT_TERMS, version: '1' },
  cart_reminders: { enabled: false, after_hours: 4 },
  document_prefixes: { invoice: 'INV', credit_note: 'CN', receipt: 'RC', quote: 'Q', confirmation: 'OC', contract: 'RA' },
  staff_email: null,
  email_from: null,
  email_channel: null,
  sms_channel: null,
  whatsapp_channel: null,
  widget_origins: [],
  theme: { id: 'default', settings: {} },
  theme_settings: {},
  theme_translations: {},
  theme_sections: {},
  theme_content_translations: {},
  storefront_code: { css: '', header_html: '', footer_html: '' },
  seo: { title: null, description: null, image_url: null },
  navigation: { header: [], footer: [] },
  self_service: { cancel: 'request', cancel_until_hours: 48, change_dates: 'off', change_until_hours: 48 },
};

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function resolveSettings(stored: unknown): TenantSettings {
  return deepMerge(DEFAULT_SETTINGS, stored ?? {});
}

/** Opening hours: { mon: [["09:00","18:00"]], ... }. Missing or empty day = closed. */
export type OpeningHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;

export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: [['09:00', '18:00']],
  tue: [['09:00', '18:00']],
  wed: [['09:00', '18:00']],
  thu: [['09:00', '18:00']],
  fri: [['09:00', '18:00']],
  sat: [['10:00', '16:00']],
};
