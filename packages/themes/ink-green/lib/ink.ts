/**
 * Ink Green: a deep green page with pale sage text, lime blocks behind big serif headlines, sage panels for
 * forms and cards, small-cornered buttons and 16px rounded panels.
 */
export const INK = '#043f2e';
export const SAGE = '#eef2e3';
export const LIME = '#c8f169';
export const MOSS = '#2a6f2b';
export const LEAF = '#78c51c';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const colour = (v: unknown, fallback: string) =>
  typeof v === 'string' && HEX.test(v)
    ? v.length === 4
      ? `#${[...v.slice(1)].map((c) => c + c).join('')}`
      : v.toLowerCase()
    : fallback;

/** Surfaces that switch to the light scheme: panels, menus, dialogs, alerts and anything marked `.ink-light`. */
const LIGHT = [
  '.ink-light',
  '[data-slot=card]',
  '[data-slot=alert]',
  '[data-slot=popover-content]',
  '[data-slot=dropdown-menu-content]',
  '[data-slot=select-content]',
  '[data-slot=sheet-content]',
  '[data-slot=dialog-content]',
  '[data-slot=alert-dialog-content]',
  '[data-sonner-toast]',
].join(',');

const vars = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** Page-wide CSS while Ink Green is showing; tokens go on :root so popovers and toasts outside the layout match. */
export function inkCss(ink: unknown, highlight: unknown): string {
  const i = colour(ink, INK);
  const h = colour(highlight, LIME);
  const dark = vars({
    '--background': i,
    '--foreground': SAGE,
    '--card': SAGE,
    '--card-foreground': i,
    '--popover': '#f6f8f0',
    '--popover-foreground': i,
    '--primary': h,
    '--primary-foreground': i,
    '--secondary': MOSS,
    '--secondary-foreground': SAGE,
    '--muted': 'rgba(238,242,227,.08)',
    '--muted-foreground': '#b9c7b4',
    '--accent': 'rgba(238,242,227,.1)',
    '--accent-foreground': SAGE,
    '--border': 'rgba(238,242,227,.2)',
    '--input': 'rgba(238,242,227,.35)',
    '--ring': h,
    '--destructive': '#fb848b',
    '--radius': '0.375rem',
    '--ink': i,
    '--ink-highlight': h,
  });
  const light = vars({
    '--background': SAGE,
    '--foreground': i,
    '--card': SAGE,
    '--card-foreground': i,
    '--popover': '#f6f8f0',
    '--popover-foreground': i,
    '--primary': i,
    '--primary-foreground': h,
    '--secondary': '#dfe6cf',
    '--secondary-foreground': i,
    '--muted': '#e2e8d4',
    '--muted-foreground': '#3f5a4f',
    '--accent': '#dfe6cf',
    '--accent-foreground': i,
    '--border': 'rgba(4,63,46,.16)',
    '--input': 'rgba(4,63,46,.35)',
    '--ring': i,
    '--destructive': '#b3261e',
  });
  return [
    `:root:root{${dark}}`,
    `:root :is(${LIGHT}){${light};color:var(--foreground)}`,
    `html,body{font-family:'Inter Variable',ui-sans-serif,system-ui,sans-serif;background:${i};color:${SAGE}}`,
    `.ink-serif{font-family:'Fraunces Variable',Georgia,serif;font-weight:400;font-optical-sizing:auto}`,
    `::selection{background:${h};color:${i}}`,
    // Panels: 16px corners and no outline ring; menus float on a soft shadow.
    `:root [data-slot=card]{border-radius:16px;box-shadow:none}`,
    `:root :is([data-slot=popover-content],[data-slot=dropdown-menu-content],[data-slot=select-content]){border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35)}`,
    `[data-slot=button]{font-weight:500}`,
  ].join('');
}

// Class sets shared by templates (kept here so Tailwind sees every class literally).

/** The page width: the nav bar, sections and footer line up on it. */
export const wrap = 'mx-auto w-full max-w-[1280px] px-4 md:px-6';
export const display = 'ink-serif text-5xl leading-[0.95] tracking-[-0.02em] sm:text-6xl lg:text-8xl';
export const h1 = 'ink-serif text-4xl leading-[1.02] tracking-[-0.02em] text-balance md:text-6xl';
export const h2 = 'ink-serif text-4xl leading-[1.05] tracking-[-0.02em] text-balance md:text-6xl';
export const h3 = 'ink-serif text-2xl leading-tight tracking-[-0.01em] md:text-3xl';
/** Mode-style buttons: tall, small corners. Solid is lime on the dark page and ink on light panels. */
export const big = 'h-12 rounded-[4px] px-7 text-base';
export const ghostLine =
  'h-12 rounded-[4px] border-current bg-transparent px-7 text-base hover:bg-current/10';
/** A sage panel holding dark text (light scheme). */
export const panel = 'ink-light rounded-2xl bg-card text-card-foreground';
/** A moss-green panel on the dark page. */
export const moss = 'rounded-2xl bg-[#2a6f2b] text-[#eef2e3]';

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}
