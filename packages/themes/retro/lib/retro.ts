/** Retro palette: warm paper, black ink and a few loud flat colours. */
export const PALETTE = {
  paper: '#f4f4f0',
  ink: '#000000',
  pink: '#ff90e8',
  yellow: '#ffc900',
  teal: '#23a094',
  purple: '#90a8ed',
  red: '#ff7051',
};

/** Sticker colours cycled across category pills and feature cards. */
export const STICKERS = [
  'var(--retro-accent)',
  'var(--retro-highlight)',
  PALETTE.teal,
  PALETTE.purple,
  PALETTE.red,
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function expand(hex: string) {
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.toLowerCase();
}

/** Black or white, whichever reads better on the colour (WCAG contrast). */
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000';
}

/**
 * Page-wide CSS while the Retro theme is showing. The shadcn tokens are set on :root so popovers and
 * toasts rendered outside the layout match too.
 */
export function retroCss(accent: unknown, highlight: unknown): string {
  const a = typeof accent === 'string' && HEX.test(accent) ? expand(accent) : PALETTE.pink;
  const h = typeof highlight === 'string' && HEX.test(highlight) ? expand(highlight) : PALETTE.yellow;
  const tokens = {
    '--background': PALETTE.paper,
    '--foreground': PALETTE.ink,
    '--card': '#ffffff',
    '--card-foreground': PALETTE.ink,
    '--popover': '#ffffff',
    '--popover-foreground': PALETTE.ink,
    '--primary': PALETTE.ink,
    '--primary-foreground': '#ffffff',
    '--secondary': '#ffffff',
    '--secondary-foreground': PALETTE.ink,
    '--muted': '#ebebe4',
    '--muted-foreground': '#4d4d4a',
    '--accent': a,
    '--accent-foreground': inkOn(a),
    '--border': PALETTE.ink,
    '--input': PALETTE.ink,
    '--ring': PALETTE.ink,
    '--radius': '0.25rem',
    '--retro-accent': a,
    '--retro-accent-ink': inkOn(a),
    '--retro-highlight': h,
    '--retro-highlight-ink': inkOn(h),
  };
  const root = Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return [
    `:root:root{${root}}`,
    `html,body{font-family:'DM Sans Variable',ui-sans-serif,system-ui,sans-serif;background:${PALETTE.paper}}`,
    // Cards are flat paper with a 1px black edge; lifted shadows come from the elements around them.
    `[data-slot=card]{border-radius:.25rem;box-shadow:0 0 0 1px ${PALETTE.ink}}`,
  ].join('');
}

/** Class sets shared by templates (kept here so Tailwind sees every class literally). */
export const wrap = 'mx-auto w-full max-w-6xl px-4 md:px-8';
export const display = 'text-4xl leading-[1.05] font-normal tracking-tight text-balance md:text-6xl';
export const title = 'text-3xl leading-tight font-normal tracking-tight md:text-4xl';
/** Moves up and left on hover and leaves a hard black shadow behind. */
export const lift =
  'transition-[translate,box-shadow] duration-150 hover:-translate-1 hover:shadow-[4px_4px_0_0_#000] active:translate-0 active:shadow-none';
export const solid = `h-12 rounded-none border-black bg-black px-6 text-base font-normal text-white hover:bg-black ${lift}`;
export const outline = `h-12 rounded-none border-black bg-white px-6 text-base font-normal text-black hover:bg-white ${lift}`;
/** NativeSelect puts `class` on its wrapper, so the box styles reach the select inside. */
export const select =
  '[&_select]:rounded-[0.25rem] [&_select]:border-black [&_select]:bg-white [&_select]:shadow-none';
export const pill =
  'h-auto rounded-full border border-black bg-white px-4 py-2 text-base font-normal text-black hover:bg-(--retro-accent) hover:text-(--retro-accent-ink)';

/** "3 days" from a quote line's charge periods. */
export function periodLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  count: number,
  unit: string | null,
): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}
