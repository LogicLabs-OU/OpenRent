import { getContext, setContext, type Component } from 'svelte';
import type { AccountProfile, CalendarDay, Money, PriceQuote, Shop } from './types.ts';

/**
 * Error thrown by runtime actions. `fields` maps a field path (e.g. `customer.email`) to its
 * message when the API rejected the input (422), so themes can show it next to the field.
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export interface CheckoutResult {
  order: { id: string; number: number; status: string; token: string };
  payment: { client_secret: string | null; public_config: { publishable_key?: string } } | null;
}

/** What a theme may do. Implemented by the storefront runtime; themes stay portable across versions. */
export interface Runtime {
  shop: Shop;
  setDates(from: string | null, to: string | null): Promise<void>;
  addToCart(variantId: string, quantity: number): Promise<void>;
  setQuantity(variantId: string, quantity: number): Promise<void>;
  applyCoupon(code: string): Promise<void>;
  /** Chooses optional fees (damage waiver, delivery…) and the delivery postcode for the cart (theme API 1.5). */
  setOptions?(options: { fees?: string[]; postcode?: string | null; address?: string | null }): Promise<void>;
  calendar(variantId: string, month: string): Promise<CalendarDay[]>;
  quote(lines: { variant_id: string; quantity: number }[], from: string, to: string): Promise<PriceQuote>;
  checkout(input: {
    customer: {
      name: string;
      email: string;
      phone?: string;
      company_name?: string;
      tax_id?: string;
      billing_address?: { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string };
    };
    terms_accepted: boolean;
    notes?: string;
  }): Promise<CheckoutResult>;
  /** Starts a new online payment for an unpaid order (theme API 1.1). */
  payOrder?(token: string): Promise<{ clientSecret: string | null; publishableKey: string | null }>;
  /**
   * Customer accounts (theme API 1.3). Cancellation requests take the order token on the order page
   * (the private link is the proof) and only the order id in the account.
   */
  account?: {
    login(email: string): Promise<void>;
    verify(token: string): Promise<void>;
    logout(): Promise<void>;
    updateProfile(patch: Partial<Pick<AccountProfile, 'name' | 'phone' | 'locale' | 'marketing_consent'>>): Promise<AccountProfile>;
    requestCancellation(order: { id: string; token?: string }, reason: string): Promise<void>;
    withdrawCancellation(order: { id: string; token?: string }): Promise<void>;
    /** Ask to keep a booking until `endsAt` (theme API 1.5); the shop approves or declines. */
    requestExtension?(order: { id: string; token?: string }, endsAt: string, reason: string): Promise<void>;
    withdrawExtension?(order: { id: string; token?: string }): Promise<void>;
  };
  t(key: string, params?: Record<string, string | number>): string;
  format: {
    money(m: Money | null | undefined): string;
    date(iso: string | null | undefined): string;
    datetime(iso: string | null | undefined): string;
    time(iso: string): string;
  };
  url: {
    home(): string;
    category(slug: string): string;
    product(slug: string): string;
    cart(): string;
    checkout(): string;
    order(token: string): string;
    page(slug: string): string;
    /** Theme API 1.3. */
    account?(): string;
    accountLogin?(): string;
    search?(params?: { q?: string; category?: string | null; available?: boolean; sort?: string }): string;
    /** PDF download of an order document; pass the order token on the order page. */
    document?(docId: string, orderToken?: string): string;
    /** Download link for a shared file; `orderToken` for the order page, none in the account (theme API 1.4). */
    attachment?(attachmentId: string, orderToken?: string): string;
    /** A photo of a damage charge on the order page (theme API 1.4). */
    damagePhoto?(fileId: string, orderToken: string): string;
    /** The current page in another storefront language (theme API 1.3). */
    switchLocale?(locale: string): string;
  };
  /**
   * URL of a file in the theme's `assets/` folder (theme API 1.4), e.g. `rt.asset('hero.webp')`. Code
   * themes get hashed URLs that browsers cache for good; child themes' files come from the API.
   */
  asset?(path: string): string;
  /** Runtime-provided components: provider-hosted payment fields and plugin slots (FR-PLG-6). */
  components: {
    Payment: Component<{ clientSecret: string; publishableKey: string; returnUrl: string; onerror?: (message: string) => void }>;
    Slot: Component<{ name: string; context?: Record<string, unknown> }>;
  };
  /** Local wall-clock helpers in the shop's time zone. */
  zone: {
    toInstant(date: string, time: string): string;
    localDate(iso: string): string;
    localTime(iso: string): string;
    timeOptions(date: string, stepMinutes?: number): string[];
  };
}

const KEY = Symbol.for('openrent.theme.runtime');

export function provideRuntime(r: Runtime) {
  setContext(KEY, r);
}

export function getRuntime(): Runtime {
  const r = getContext<Runtime | undefined>(KEY);
  if (!r) throw new Error('OpenRent theme runtime is missing: templates must render inside the storefront runtime');
  return r;
}
