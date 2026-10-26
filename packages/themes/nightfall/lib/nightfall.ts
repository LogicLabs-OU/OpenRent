/**
 * Nightfall: a black, cinematic page with soft amber and blue glows, glass cards with a hairline border, white
 * text in opacity steps, an indigo accent for buttons and one handwritten (or serif italic) word per headline.
 */
export const ACCENT = '#5351f3';
export const WARM = '#a8601a';
export const COOL = '#1d3bd1';
export const PAGE = '#000000';
/** The near-black of panels that sit straight on the page. */
export const NIGHT = '#0b0a12';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const colour = (v: unknown, fallback: string) =>
  typeof v === 'string' && HEX.test(v)
    ? v.length === 4
      ? `#${[...v.slice(1)].map((c) => c + c).join('')}`
      : v.toLowerCase()
    : fallback;

const vars = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** The glass gradient of cards and panels. */
export const GLASS = 'linear-gradient(rgba(39,39,42,.92),rgba(24,24,27,.97) 60%,rgba(24,24,27,.92))';

/**
 * Page-wide CSS while Nightfall is showing. Tokens go on :root so popovers, dialogs and toasts outside the layout
 * are dark too; the rules are unlayered so they win over the component defaults.
 */
export function nightfallCss(s: Record<string, unknown>): string {
  const accent = colour(s.accent, ACCENT);
  const page = colour(s.page, PAGE);
  const serif = s.accent_font === 'serif';
  const tokens = vars({
    '--background': page,
    '--foreground': '#ffffff',
    '--card': '#18181b',
    '--card-foreground': '#ffffff',
    '--popover': '#141418',
    '--popover-foreground': '#ffffff',
    '--primary': accent,
    '--primary-foreground': '#ffffff',
    '--secondary': '#27272a',
    '--secondary-foreground': '#ffffff',
    '--muted': 'rgba(255,255,255,.06)',
    '--muted-foreground': 'rgba(255,255,255,.68)',
    '--accent': 'rgba(255,255,255,.08)',
    '--accent-foreground': '#ffffff',
    '--border': 'rgba(255,255,255,.1)',
    '--input': 'rgba(255,255,255,.22)',
    '--ring': `color-mix(in oklab,${accent} 55%,white)`,
    '--destructive': '#ff7a80',
    '--radius': '0.875rem',
    '--nf-accent': accent,
    '--nf-accent-text': `color-mix(in oklab,${accent} 50%,white)`,
    '--nf-warm': colour(s.glow_warm, WARM),
    '--nf-cool': colour(s.glow_cool, COOL),
    '--nf-page': page,
    '--nf-accent-font': serif ? "'Playfair Display Variable',Georgia,serif" : "'Dancing Script',cursive",
    '--nf-accent-style': serif ? 'italic' : 'normal',
    '--nf-accent-weight': serif ? '500' : '600',
    '--nf-accent-size': serif ? '1.02em' : '1.12em',
  });
  return [
    // The layout carries `.dark` (for the components' dark variants), which redefines the tokens; ours win.
    `:root:root,:root .dark{${tokens}}`,
    `html{color-scheme:dark;background:${page}}`,
    `html,body{font-family:'Plus Jakarta Sans Variable',ui-sans-serif,system-ui,sans-serif;background:${page};color:#fff}`,
    `::selection{background:${accent};color:#fff}`,
    `:root [data-slot=card]{background:${GLASS};border-radius:24px;box-shadow:none;--tw-ring-color:rgba(255,255,255,.1)}`,
    `:root [data-slot=card-title]{font-size:1.25rem;line-height:1.3;font-weight:600;letter-spacing:-0.02em}`,
    `:root :is([data-slot=popover-content],[data-slot=dropdown-menu-content],[data-slot=select-content]){background:#141418;border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.6)}`,
    `:root :is([data-slot=dialog-content],[data-slot=alert-dialog-content]){background:${GLASS};border:1px solid rgba(255,255,255,.12);border-radius:28px;box-shadow:0 40px 120px rgba(0,0,0,.7)}`,
    `:root [data-slot=sheet-content]{background:${NIGHT};border-color:rgba(255,255,255,.1)}`,
    `:root :is([data-slot=dialog-overlay],[data-slot=sheet-overlay],[data-slot=alert-dialog-overlay]){background:rgba(0,0,0,.6);backdrop-filter:blur(6px)}`,
    `:root [data-slot=button]{border-radius:9999px;font-weight:600}`,
    `:root :is([data-slot=input],[data-slot=textarea],[data-slot=native-select],[data-slot=input-group]){border-radius:14px;background-color:rgba(255,255,255,.04)}`,
    `:root :is([data-slot=input],[data-slot=native-select]){height:2.75rem}`,
    `:root [data-slot=alert]{background:${GLASS};border-color:rgba(255,255,255,.12);border-radius:18px}`,
    `[data-sonner-toaster]{--normal-bg:#18181b!important;--normal-text:#fff!important;--normal-border:rgba(255,255,255,.12)!important}`,
  ].join('');
}

// Class sets shared by templates (kept here so Tailwind sees every class literally).

/** The page width: the nav bar, sections and footer line up on it. */
export const wrap = 'mx-auto w-full max-w-[1296px] px-4 md:px-8';
export const display =
  'text-[2.75rem] leading-[1.04] font-semibold tracking-[-0.03em] text-balance sm:text-6xl lg:text-7xl';
export const h1 = 'text-4xl leading-[1.06] font-semibold tracking-[-0.03em] text-balance md:text-6xl';
export const h2 = 'text-4xl leading-[1.06] font-semibold tracking-[-0.03em] text-balance md:text-[3.5rem]';
export const h3 = 'text-2xl leading-tight font-semibold tracking-[-0.02em] md:text-3xl';
/** Body copy at white/70. */
export const body = 'text-base leading-[1.6] text-white/70 md:text-lg';
/** Small labels above headings, in the light accent. */
export const label = 'text-[0.8125rem] font-semibold text-[color:var(--nf-accent-text)]';
/** A dark glass card with a hairline border. */
export const glass = 'nf-glass rounded-3xl';
/** Tall pill buttons: solid indigo, or white glass. */
export const big = 'h-12 rounded-full px-6 text-[0.9375rem]';
export const pill =
  'h-12 rounded-full border border-white/15 bg-white/10 px-6 text-[0.9375rem] text-white backdrop-blur-md hover:bg-white/15 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/15';

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}

/** Splits "Your gear, at your *door.*" into plain parts and accent parts (the starred words). */
export function accentParts(text: string): { text: string; accent: boolean }[] {
  return String(text ?? '')
    .split(/\*([^*]+)\*/)
    .map((t, i) => ({ text: t, accent: i % 2 === 1 }))
    .filter((p) => p.text);
}

/** A stable colour family (0–5) for a name, so a product's placeholder looks the same everywhere. */
export function tone(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}
