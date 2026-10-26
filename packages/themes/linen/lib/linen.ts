/**
 * Linen: a calm consultancy look. Light grey page, slightly darker panels, white cards, near-black ink, a bronze
 * accent for links and highlighted words, a signal orange for small square bullets, beige media panels and a dark
 * rounded footer. Headings in Instrument Sans at regular weight, body in Inter, tiny meta in DM Mono.
 */
export const PAGE = '#f5f5f5';
export const INK = '#202020';
export const BODY = '#4d4d4d';
export const BRONZE = '#816729';
export const ORANGE = '#ff682c';
export const BEIGE = '#ebe6dd';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const colour = (v: unknown, fallback: string) =>
  typeof v === 'string' && HEX.test(v)
    ? v.length === 4
      ? `#${[...v.slice(1)].map((c) => c + c).join('')}`
      : v.toLowerCase()
    : fallback;

const vars = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** Page-wide CSS while Linen is showing; tokens go on :root so popovers and toasts outside the layout match. */
export function linenCss(settings: Record<string, unknown>): string {
  const page = colour(settings.page, PAGE);
  const accent = colour(settings.accent, BRONZE);
  const signal = colour(settings.signal, ORANGE);
  const tokens = vars({
    '--background': page,
    '--foreground': INK,
    '--card': '#ffffff',
    '--card-foreground': INK,
    '--popover': '#ffffff',
    '--popover-foreground': INK,
    '--primary': INK,
    '--primary-foreground': '#ffffff',
    '--secondary': `color-mix(in srgb, ${page} 97.5%, #000)`,
    '--secondary-foreground': INK,
    '--muted': `color-mix(in srgb, ${page} 97.5%, #000)`,
    '--muted-foreground': '#666666',
    '--accent': `color-mix(in srgb, ${page} 95%, #000)`,
    '--accent-foreground': INK,
    '--border': 'rgba(32,32,32,.1)',
    '--input': 'rgba(32,32,32,.2)',
    '--ring': accent,
    '--destructive': '#b42318',
    '--radius': '0.625rem',
    '--ln-page': page,
    '--ln-panel': `color-mix(in srgb, ${page} 97.5%, #000)`,
    '--ln-ink': INK,
    '--ln-body': BODY,
    '--ln-accent': accent,
    '--ln-signal': signal,
    '--ln-beige': BEIGE,
  });
  return [
    `:root:root{${tokens}}`,
    `html,body{font-family:'Inter Variable',ui-sans-serif,system-ui,sans-serif;background:${page};color:${INK}}`,
    `::selection{background:${accent};color:#fff}`,
    // White cards on grey: 20px corners, no outline ring, no shadow.
    `:root [data-slot=card]{border-radius:20px;box-shadow:none}`,
    `:root :is([data-slot=popover-content],[data-slot=dropdown-menu-content],[data-slot=select-content]){border-radius:14px;border:0;box-shadow:0 18px 48px rgba(32,32,32,.14),0 0 0 1px rgba(32,32,32,.06)}`,
    // Every button is a pill.
    `[data-slot=button]{border-radius:999px;font-weight:450}`,
    `:root :is([data-slot=input],[data-slot=textarea],[data-slot=native-select],[data-slot=input-group]){background:#fff}`,
    `:root [data-slot=alert]{border-radius:14px}`,
  ].join('');
}

// Class sets shared by templates (kept here so Tailwind sees every class literally).

/** The page width: the nav bar, sections and footer line up on it. */
export const wrap = 'mx-auto w-full max-w-[1440px] px-4 md:px-10 lg:px-[60px]';
export const display = 'ln-display text-[2.75rem] leading-[1] tracking-[-0.02em] sm:text-6xl lg:text-[4.125rem]';
export const h1 = 'ln-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-balance md:text-[3.25rem]';
export const h2 = 'ln-display text-[2.25rem] leading-[1.04] tracking-[-0.02em] text-balance md:text-5xl';
export const h3 = 'ln-display text-2xl leading-[1.15] tracking-[-0.01em] md:text-[2rem]';
/** Grey running text. */
export const lead = 'text-lg leading-[1.45] text-[#4d4d4d] md:text-xl';
/** Small bronze line under a title. */
export const subtitle = 'text-[0.8125rem] font-medium text-[var(--ln-accent)]';
/** Pill buttons; the fill slides in from the left on hover (see assets/linen.css). */
export const btn = 'ln-btn h-11 px-6 text-base';
export const btnLine = 'ln-btn ln-btn-line h-11 border-[#202020] bg-transparent px-6 text-base hover:bg-transparent';
/** Grey panel, white card and beige media panel. */
export const panel = 'rounded-[20px] bg-[var(--ln-panel)]';
export const card = 'rounded-[20px] bg-white';
export const media = 'rounded-[20px] bg-[var(--ln-beige)]';

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}

/**
 * A heading split into lines (one per line break) and words, with one word marked for the bronze underline:
 * `mark` names it (case-insensitive, punctuation ignored); empty marks the last word, `false` none.
 */
export function headingLines(text: string, mark: string | false = ''): { word: string; mark: boolean }[][] {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/));
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
  const want = mark === false ? '' : bare(String(mark ?? '').trim());
  let at = want || mark === false ? -1 : lines.length - 1;
  let col = want ? -1 : (lines[at]?.length ?? 0) - 1;
  for (let i = 0; want && at < 0 && i < lines.length; i++) {
    const j = lines[i]!.findIndex((w) => bare(w) === want);
    if (j >= 0) [at, col] = [i, j];
  }
  return lines.map((l, i) => l.map((word, j) => ({ word, mark: i === at && j === col })));
}

/** One line per non-empty row of a textarea. */
export const rows = (v: unknown) =>
  String(v ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
