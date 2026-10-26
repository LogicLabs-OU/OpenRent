/**
 * Concept: a calm, document-like storefront. Warm near-black text on white, a soft grey sidebar,
 * hairline borders, small radii, emoji page icons, soft colour tags and quiet hover fills.
 */
export const INK = '#32302c';
export const MUTED = '#6b6964';
export const LINE = '#e9e8e5';
export const WASH = '#f8f7f5';
export const HOVER = 'rgba(50, 48, 44, 0.06)';
export const DEFAULT_ACCENT = '#1f6fc5';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const expand = (hex: string) =>
  hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.toLowerCase();

/** White or ink, whichever reads better on the colour (WCAG contrast). */
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : INK;
}

const FONT =
  'ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI Variable Display","Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif';
/** The shadow of floating menus and the cards of gallery views. */
const FLOAT = 'rgba(15,15,15,.05) 0 0 0 1px,rgba(15,15,15,.1) 0 3px 6px,rgba(15,15,15,.2) 0 9px 24px';

/** Page-wide CSS while Concept is showing. Tokens go on :root so popovers and toasts rendered outside the layout match. */
export function conceptCss(accent: unknown, fullWidth: boolean): string {
  const a = typeof accent === 'string' && HEX.test(accent) ? expand(accent) : DEFAULT_ACCENT;
  const tokens: Record<string, string> = {
    '--background': '#ffffff',
    '--foreground': INK,
    '--card': '#ffffff',
    '--card-foreground': INK,
    '--popover': '#ffffff',
    '--popover-foreground': INK,
    '--primary': a,
    '--primary-foreground': inkOn(a),
    '--secondary': WASH,
    '--secondary-foreground': INK,
    '--muted': '#f1f0ee',
    '--muted-foreground': MUTED,
    '--accent': '#efeeec',
    '--accent-foreground': INK,
    '--border': LINE,
    '--input': '#dfdedb',
    '--ring': a,
    '--destructive': '#c4372b',
    '--radius': '0.375rem',
    '--concept-wash': WASH,
    '--concept-hover': HOVER,
    '--concept-width': fullWidth ? '1280px' : '960px',
  };
  const root = Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return [
    `:root:root{${root}}`,
    `html,body{font-family:${FONT};background:#fff;color:${INK};-webkit-font-smoothing:antialiased}`,
    `::selection{background:rgba(35,131,226,.25)}`,
    // Cards are flat with a hairline (the UI kit draws card outlines as a ring); menus float on a soft layered shadow.
    `:root [data-slot=card]{box-shadow:0 0 0 1px ${LINE}}`,
    `:root :is([data-slot=popover-content],[data-slot=dropdown-menu-content],[data-slot=select-content]){box-shadow:${FLOAT};border-color:transparent}`,
    `[data-slot=button]{font-weight:500}`,
  ].join('');
}

// Class sets shared by templates (kept here so Tailwind sees every class literally).

/** The page column: covers run full width, everything else sits in this. */
export const col = 'mx-auto w-full max-w-(--concept-width) px-5 sm:px-12';
export const title = 'text-[2.5rem] leading-[1.2] font-bold tracking-[-0.01em] text-balance';
export const h2 = 'text-2xl leading-[1.3] font-semibold tracking-[-0.005em]';
export const h3 = 'text-xl leading-[1.3] font-semibold';
/** A row that fills softly on hover, like a block or a sidebar item. */
export const row = 'rounded-[4px] transition-colors hover:bg-(--concept-hover)';
/** Grey section label above a group (sidebar groups, property names). */
export const label = 'text-xs font-medium text-muted-foreground';

/** Soft tag colours: background and text, readable at AA. */
export const TAGS = {
  gray: ['#e9e8e5', '#3f3c37'],
  brown: ['#eee0da', '#5f3a29'],
  orange: ['#fadec9', '#6b3a12'],
  yellow: ['#fbeccb', '#5c4410'],
  green: ['#dbecdc', '#1f4a2c'],
  blue: ['#d6e6f1', '#1d3f5c'],
  purple: ['#e7def0', '#4a2a62'],
  pink: ['#f4e0ea', '#5c2541'],
  red: ['#fde1dc', '#6e2318'],
} as const;
export type TagColor = keyof typeof TAGS;
const TAG_ORDER: TagColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray'];

/** Soft covers for pages without a picture. */
const COVERS = [
  'linear-gradient(120deg,#d6e6f1 0%,#e7def0 55%,#f4e0ea 100%)',
  'linear-gradient(120deg,#dbecdc 0%,#d6e6f1 100%)',
  'linear-gradient(120deg,#fbeccb 0%,#fadec9 60%,#fde1dc 100%)',
  'linear-gradient(120deg,#eee0da 0%,#fbeccb 100%)',
  'linear-gradient(120deg,#e7def0 0%,#d6e6f1 100%)',
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Emoji per category from the `category_icons` setting, one `slug = emoji` per line. Categories without one
 * get the plain page icon.
 */
export function categoryIcons(setting: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(setting ?? '').split('\n')) {
    const m = line.match(/^\s*([^=\s]+)\s*=\s*(\S.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export const coverFor = (seed: string) => COVERS[hash(seed) % COVERS.length]!;
export const tagFor = (seed: string): TagColor => TAG_ORDER[hash(seed) % TAG_ORDER.length]!;

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}
