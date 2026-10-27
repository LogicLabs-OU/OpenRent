/**
 * Typed, read-only data a storefront theme receives (PRD §3.16 FR-THM-2).
 * Themes never call the API: the runtime fetches data and exposes actions.
 */
export interface Money {
  amount: number;
  currency: string;
}

export type OpeningHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  branding: { primary_color?: string; logo_url?: string; [k: string]: unknown };
}

export interface Location {
  id: string;
  name: string;
  address: Record<string, string>;
  timezone: string;
  opening_hours: OpeningHours;
  is_default: boolean;
  /** Contact details shown with the location (theme API 1.9). */
  phone?: string | null;
  email?: string | null;
  /** Times customers may choose for a delivery or collection, per weekday (theme API 1.9). */
  delivery_windows?: OpeningHours;
  /** When it is closed in the next 60 days (theme API 1.9). */
  closures?: { starts_at: string; ends_at: string; reason: string | null }[];
}

/** Search engine texts in the page's language; null where the shop wrote none (theme API 1.9). */
export interface Seo {
  title: string | null;
  description: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  position: number;
  seo?: Seo;
}

export interface VariantPrice {
  kind: 'fixed' | 'per_period' | 'tiered' | 'table';
  period_unit: 'hour' | 'day' | 'week' | 'month';
  amount: Money;
  description: string;
  /** The price of the shortest rental: `periods` of `period_unit` (a price table's first row), else one (theme API 1.9). */
  from?: { amount: Money; periods: number };
}

export interface Variant {
  id: string;
  name: string;
  options: Record<string, string>;
  tracking: 'serialized' | 'bulk' | 'none';
  price: VariantPrice | null;
  available?: number | null;
  /** On the product page, when none is free at the chosen location: the locations that have it (theme API 1.9). */
  elsewhere?: { location_id: string; name: string; available: number | null }[];
}

/** A custom field the shop shows to customers (theme API 1.4); `display` is ready to print. */
export interface ShownField {
  key: string;
  label: string;
  type: string;
  value: unknown;
  display: string;
}

export interface Product {
  id: string;
  slug: string;
  type: string;
  name: string;
  /** Plain text (cards, meta tags). */
  description: string;
  /** The description as cleaned HTML for the product page (theme API 1.4). */
  description_html?: string;
  /** Custom fields the shop shows on product pages (theme API 1.4). */
  fields?: ShownField[];
  /** Labels from plugins for this product, shown by the `product.before_add` slot (theme API 1.4). */
  badges?: { label: string; tone: 'default' | 'success' | 'warning' }[];
  tags: string[];
  category_ids: string[];
  /** `url` is a large WebP, `url_sm` a 480px-wide one for cards (theme API 1.2). */
  images: { url: string; url_sm?: string; alt?: string; width?: number | null; height?: number | null }[];
  deposit_amount: Money;
  min_duration_min: number | null;
  max_duration_min: number | null;
  min_notice_min: number;
  increment_min: number | null;
  variants: Variant[];
  /** Search engine texts (theme API 1.9); the storefront puts them in the page head. */
  seo?: Seo;
  updated_at?: string;
  /**
   * What always comes with a bundle, and its slots of alternatives (theme API 1.7, FR-CAT-6). The
   * `product.before_add` slot shows the picker; themes may list `components` as "includes".
   */
  bundle: {
    components: { name: string; quantity: number }[];
    slots?: { name: string; options: { variant_id: string; name: string; quantity: number; available: number | null }[] }[];
  } | null;
  /** Offered with the product, ticked in the `product.before_add` slot (theme API 1.7, FR-CAT-7). */
  accessories?: RelatedProduct[];
  /** Products that go with it: staff's choice, then those often rented with it (theme API 1.7). */
  related?: RelatedProduct[];
}

export interface RelatedProduct {
  id: string;
  name: string;
  slug: string;
  type: string;
  variant_id: string | null;
  price: { description: string } | null;
  image: { url: string; url_sm?: string; alt: string } | null;
}

export interface QuoteLine {
  key: string;
  name: string;
  quantity: number;
  periods: number;
  charge_periods: number;
  period_unit: string | null;
  unit_price: Money;
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  deposit: Money;
  explanation: string[];
}

export interface PriceQuote {
  currency: string;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  fees: Money;
  tax: Money;
  total: Money;
  deposit: Money;
  coupon_errors: { code: string; reason: string }[];
  coupons_applied: { code: string; amount: Money }[];
  /**
   * Extras the customer may add, priced for this cart (theme API 1.5); choose them with `rt.setOptions`.
   * `priced_by` (theme API 1.8): a delivery priced by postcode zone or by distance to the address.
   */
  optional_fees?: { id: string; name: string; kind: 'delivery' | 'cleaning' | 'damage_waiver'; amount: Money; selected: boolean; priced_by?: 'postcode' | 'distance' | null }[];
  /**
   * A chosen delivery that needs a postcode, or one outside every zone (theme API 1.5); by distance
   * (theme API 1.8), one that needs the address, cannot find it, or is too far.
   */
  fee_errors?: { fee_id: string; reason: 'postcode_required' | 'postcode_not_served' | 'address_required' | 'address_not_found' | 'address_too_far' }[];
}

export interface CalendarDay {
  date: string;
  available: number | null;
  status: 'available' | 'unavailable' | 'closed' | 'past' | 'notice';
  reason?: string;
}

export interface CartLine {
  variant_id: string;
  quantity: number;
  product_name?: string;
  product_slug?: string;
  variant_name?: string;
}

export interface Cart {
  id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  lines: CartLine[];
  coupon_codes: string[];
  /** Optional fees chosen and the delivery postcode (theme API 1.5). */
  options?: { fees: string[]; postcode: string | null; address?: string | null };
  quote: PriceQuote | null;
  availability: { variant_id: string; requested: number; available: number | null; ok: boolean; problems: { field: string; message: string }[] }[];
  quote_error: { code: string; message: string } | null;
}

export interface Dates {
  from: string | null;
  to: string | null;
}

export interface PublicOrder {
  id: string;
  number: number;
  status: string;
  payment_status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: { name: string; address: Record<string, string> } | null;
  lines: { description: string; quantity: number; total: Money }[];
  totals: { total: Money; deposit: Money; paid: Money; balance: Money };
  payment_pending: boolean;
  /** The customer can pay online now (theme API 1.1). */
  payable?: boolean;
  /** What a payment now would charge: a down payment, an open request or the balance (theme API 1.2). */
  amount_due?: Money;
  qr_svg: string;
  token: string;
  /** The latest cancellation request, if any (theme API 1.3). */
  cancellation_request?: CancellationRequest | null;
  /** The customer may ask the shop to cancel (theme API 1.3). */
  can_request_cancellation?: boolean;
  /** The latest request to keep the booking longer (theme API 1.5). */
  extension_request?: ExtensionRequest | null;
  /** The customer may ask to keep the booking longer (theme API 1.5). */
  can_request_extension?: boolean;
  /** Customer-facing documents; download with `url.document` when `shop.features.document_pdfs` (theme API 1.3). */
  documents?: OrderDocument[];
  /** Files the shop shared on this booking; download with `url.attachment` (theme API 1.4). */
  attachments?: OrderAttachment[];
  /** Custom fields the shop shows on bookings (theme API 1.4). */
  fields?: ShownField[];
  /** Damage found after the return; photos load from `url.damagePhoto` (theme API 1.4). */
  damage_charges?: { id: string; description: string; amount: Money; status: string; photo_ids: string[] }[];
}

export interface CancellationRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  reason: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

/** A customer's request to keep a booking longer (theme API 1.5). */
export interface ExtensionRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  requested_ends_at: string;
  reason: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface OrderDocument {
  id: string;
  type: string;
  number: string | null;
}

/** A file the shop shared with the customer (theme API 1.4). */
export interface OrderAttachment {
  id: string;
  label: string;
  filename: string;
  content_type: string;
  size: number;
}

/** One booking in the customer's account (theme API 1.3). */
export interface AccountOrder {
  id: string;
  number: number;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  total: Money;
  /** For `url.order(token)`. */
  token: string;
  upcoming: boolean;
  can_request_cancellation: boolean;
  cancellation_request: CancellationRequest | null;
  /** Theme API 1.5. */
  can_request_extension?: boolean;
  extension_request?: ExtensionRequest | null;
  documents: OrderDocument[];
  /** Files the shop shared on this booking (theme API 1.4). */
  attachments?: OrderAttachment[];
}

export interface AccountProfile {
  email: string;
  name: string;
  phone: string | null;
  locale: string | null;
  marketing_consent: boolean;
}

export interface Account extends AccountProfile {
  orders: AccountOrder[];
}

/** A menu link (theme API 1.9): `href` is ready to use, with the language prefix; `external` opens another site. */
export interface NavLink {
  label: string;
  href: string;
  external: boolean;
}

export interface Shop {
  tenant: Tenant;
  locations: Location[];
  /** The location the visitor rents from: the one they picked, else the default (theme API 1.9). */
  location?: Location;
  categories: Category[];
  terms: { text: string; version: string; hash: string };
  cancellation_policy: { hours_before: number; refund_pct: number }[];
  payment: { provider: string; publishable_key?: string } | null;
  locale: string;
  dates: Dates;
  cartCount: number;
  /** Theme settings: settings_data.json merged with the tenant's overrides. */
  settings: Record<string, unknown>;
  /** URLs of the theme's assets/ files by path (theme API 1.4); use `rt.asset(path)`. */
  assets?: Record<string, string>;
  /** The shop's wording of storefront texts; `rt.t` applies it (theme API 1.4). */
  strings?: Record<string, string>;
  displayPricesIncludingTax: boolean;
  /**
   * The currency prices are shown in (theme API 1.8, FR-I18N-7). `rt.format.money` converts to it on
   * browsing pages, marked as approximate; checkout and order pages show what is charged, in `base`.
   */
  displayCurrency?: { base: string; shown: string; rate: number; choices: string[] };
  /** Languages the shop offers, default first (theme API 1.3); `locale` is the one shown. */
  locales?: string[];
  /** The signed-in customer, or null (theme API 1.3). */
  customer?: { name: string; email: string } | null;
  /** What this storefront can do (theme API 1.3). */
  features?: { document_pdfs: boolean; accounts: boolean };
  /**
   * The shop's own menus (theme API 1.9). An empty `header` means the theme's usual menu (the
   * categories); `footer` links go next to the rental terms.
   */
  navigation?: { header: NavLink[]; footer: NavLink[] };
}

// Template data objects --------------------------------------------------------

export interface IndexData {
  products: Product[];
  /** The home layout with defaults filled in (theme API 1.3; empty for themes without sections). */
  sections?: import('./manifest.ts').SectionInstance[];
}
export interface CollectionData {
  category: Category;
  products: Product[];
}
export interface ProductData {
  product: Product;
}
export interface CartData {
  cart: Cart;
}
export interface CheckoutData {
  cart: Cart;
}
export interface OrderConfirmationData {
  order: PublicOrder;
  /** Outcome when the customer just returned from the payment page (theme API 1.1). */
  payment_result?: 'succeeded' | 'processing' | 'failed' | null;
}
export interface PageData {
  title: string;
  /** Plain text (the rental terms); pages the shop wrote have `body_html` instead (theme API 1.9). */
  body: string;
  /** The page's text as cleaned HTML; render it with `{@html}` in a prose block (theme API 1.9). */
  body_html?: string;
  /**
   * The page's sections for this theme (theme API 1.9), as on the home page: render them with the same
   * section components as `templates/index`. `products` is there for product sections.
   */
  sections?: import('./manifest.ts').SectionInstance[];
  products?: Product[];
}
export interface NotFoundData {
  path: string;
}
/** The signed-in customer's bookings and profile (theme API 1.3). */
export interface AccountData {
  account: Account;
}
/**
 * Sign-in page states (theme API 1.3): `form` asks for the email, `sent` says to check the inbox,
 * `verify` shows a button that completes sign-in with `token` (link scanners cannot use it up).
 */
export interface AccountLoginData {
  state: 'form' | 'sent' | 'verify';
  token?: string;
  email?: string;
}
/** Signing a document with an emailed code (theme API 1.6). `document_url` shows the document in a frame. */
export interface SignData {
  token: string;
  status: 'pending' | 'signed' | 'cancelled' | 'expired';
  signer_name: string;
  /** Partly hidden, e.g. "a•••@example.com". */
  signer_email: string;
  code_sent: boolean;
  expires_at: string;
  signed_at: string | null;
  document: { id: string; type: string; title: string; number: string | null; issued_at: string | null };
  document_url: string;
}
/** Catalogue search (theme API 1.3). */
export interface SearchData {
  query: string;
  category: string | null;
  available: boolean;
  sort: 'relevance' | 'name' | 'newest';
  products: Product[];
}

export type TemplateName = 'index' | 'collection' | 'product' | 'cart' | 'checkout' | 'order-confirmation' | 'page' | '404' | 'account' | 'account-login' | 'search' | 'sign';
