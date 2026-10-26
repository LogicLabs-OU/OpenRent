import type { Product, Runtime } from '@openrent/theme-sdk';

/**
 * Marquee: a box-office poster wall. Paper page, ink type and 1px rules, electric blue and signal orange,
 * condensed capitals with outlined lines, square corners and a dark footer.
 */
export const PAPER = '#f5f5f3';
export const INK = '#181818';
export const BLUE = '#1b1bff';
export const ORANGE = '#e3530f';
export const GREY = '#bbbcc4';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const colour = (v: unknown, fallback: string) =>
  typeof v === 'string' && HEX.test(v)
    ? v.length === 4
      ? `#${[...v.slice(1)].map((c) => c + c).join('')}`
      : v.toLowerCase()
    : fallback;

/** Relative luminance (WCAG) of a #rrggbb colour. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** White or ink, whichever reads better on `bg`. */
export function onColour(bg: string): string {
  const l = luminance(bg);
  return (1.05 / (l + 0.05) >= (l + 0.05) / (luminance(INK) + 0.05) ? '#ffffff' : INK);
}

const vars = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** Page-wide tokens while Marquee is showing; they go on :root so popovers and toasts outside the layout match. */
export function marqueeCss(settings: Record<string, unknown>): string {
  const accent = colour(settings.accent, BLUE);
  const accent2 = colour(settings.accent_2, ORANGE);
  const paper = colour(settings.paper, PAPER);
  const tokens = vars({
    '--background': paper,
    '--foreground': INK,
    '--card': paper,
    '--card-foreground': INK,
    '--popover': '#ffffff',
    '--popover-foreground': INK,
    '--primary': accent,
    '--primary-foreground': onColour(accent),
    '--secondary': 'rgba(187,188,196,.28)',
    '--secondary-foreground': INK,
    '--muted': 'rgba(187,188,196,.22)',
    '--muted-foreground': '#4a4b53',
    '--accent': 'rgba(187,188,196,.3)',
    '--accent-foreground': INK,
    '--border': INK,
    '--input': INK,
    '--ring': accent,
    '--destructive': '#b5340a',
    '--radius': '0.125rem',
    '--mq-paper': paper,
    '--mq-ink': INK,
    '--mq-accent': accent,
    '--mq-on-accent': onColour(accent),
    '--mq-accent-2': accent2,
    '--mq-on-accent-2': onColour(accent2),
    '--mq-grey': GREY,
  });
  return [
    `:root:root{${tokens}}`,
    `html,body{background:${paper};color:${INK}}`,
    `::selection{background:${accent};color:${onColour(accent)}}`,
  ].join('');
}

// Class sets shared by templates (kept here so Tailwind sees every class literally).

/** The page width: the header, sections and footer line up on it. */
export const wrap = 'mx-auto w-full max-w-[1520px] px-4 md:px-10';
/** Giant two-line titles: condensed capitals, tight lines, negative tracking. */
export const display = 'mq-tight text-[clamp(3.25rem,9.4vw,8.4375rem)] leading-[0.86] font-bold uppercase';
export const h1 = 'mq-tight text-[clamp(2.75rem,7vw,6.25rem)] leading-[0.88] font-bold uppercase text-balance';
export const h2 = 'mq-tight text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.9] font-bold uppercase text-balance';
export const h3 = 'mq-tight text-[1.75rem] leading-[0.95] font-bold uppercase md:text-[2rem]';
/** Small uppercase labels above values and in meta rows. */
export const label = 'text-[0.8125rem] leading-tight font-semibold tracking-[0.04em] uppercase';
/** A square 1px ink box. */
export const box = 'border border-(--mq-ink) bg-(--mq-paper)';
/** The box header: an ink bar with a step number and a title. */
export const boxHead =
  'flex items-center gap-3 border-b border-(--mq-ink) px-4 py-3 text-xl font-bold uppercase tracking-[-0.01em] md:px-5';
/** Solid blue call to action: tall, square, condensed capitals, with an arrow that nudges right. */
export const cta =
  'mq-cta h-14 rounded-none bg-(--mq-accent) px-6 text-[1.375rem] font-bold tracking-[-0.01em] text-(--mq-on-accent) uppercase hover:bg-(--mq-ink) hover:text-(--mq-paper) [&_svg:not([class*=size-])]:size-5';
/** The outlined counterpart. */
export const ghost =
  'mq-ghost h-12 rounded-none border-(--mq-ink) bg-transparent px-5 text-lg font-bold uppercase hover:bg-(--mq-ink) hover:text-(--mq-paper)';

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}

/** "from €12 / day" for a product's cheapest priced option, or ''. */
export function priceFrom(rt: Runtime, p: Product): string {
  const prices = p.variants.map((v) => v.price).filter((x) => !!x);
  if (!prices.length) return '';
  const low = prices.reduce((a, b) => (b.amount.amount < a.amount.amount ? b : a));
  const amount = rt.t('product.from', { price: rt.format.money(low.amount) });
  return low.kind === 'fixed' ? amount : `${amount} / ${rt.t(`period.${low.period_unit}.one`)}`;
}

/** The product's first category name, for meta rows. */
export function categoryOf(rt: Runtime, p: Product): string {
  return rt.shop.categories.find((c) => p.category_ids.includes(c.id))?.name ?? '';
}

/** Two-digit counts for the chip cells ("05", "42"). */
export const pad = (n: number) => String(n).padStart(2, '0');

/** A stable small number from a string, to pick placeholder colours and patterns. */
export function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
