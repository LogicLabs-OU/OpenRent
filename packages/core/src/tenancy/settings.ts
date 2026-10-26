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

export interface TenantSettings {
  display_prices_including_tax: boolean;
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
  /** The shop's own CSS and header/footer HTML, cleaned on save (FR-SF-4). */
  storefront_code: { css: string; header_html: string; footer_html: string; translations?: Record<string, { header_html?: string; footer_html?: string }> };
}

export const DEFAULT_TERMS = `1. The renter is responsible for the equipment from pickup until return.
2. Equipment must be returned clean and in the condition it was received.
3. Late returns are charged at the regular rate for each extra period.
4. Damage or loss is charged at repair or replacement cost and may be captured from the deposit.`;

export const DEFAULT_SETTINGS: TenantSettings = {
  display_prices_including_tax: true,
  quote_ttl_hours: 48,
  quote_holds_stock: true,
  storefront_hold_minutes: 30,
  late_grace_minutes: 60,
  late_fees_enabled: true,
  damage_waiver_excess: 0,
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
  document_prefixes: { invoice: 'INV', credit_note: 'CN', receipt: 'RC', quote: 'Q', confirmation: 'OC', contract: 'RA' },
  staff_email: null,
  email_from: null,
  email_channel: null,
  widget_origins: [],
  theme: { id: 'default', settings: {} },
  theme_settings: {},
  theme_translations: {},
  theme_sections: {},
  theme_content_translations: {},
  storefront_code: { css: '', header_html: '', footer_html: '' },
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
