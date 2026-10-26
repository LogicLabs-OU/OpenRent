/** Turns the shop's accent colour and radius setting into shadcn CSS variable overrides. */
export function brandCss(accent: string | undefined, radiusPx: number): string {
  const rules: string[] = [];
  const hex = typeof accent === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) ? accent : null;
  if (hex) {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Pick the text colour with the higher WCAG contrast against the accent.
    const fg = (1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05) ? '#ffffff' : '#0a0a0a';
    rules.push(`--primary:${full}`, `--primary-foreground:${fg}`, `--ring:${full}`);
  }
  if (Number.isFinite(radiusPx)) rules.push(`--radius:${Math.max(0, Math.min(24, radiusPx))}px`);
  return rules.length ? `:root{${rules.join(';')}}` : '';
}

/** "3 days" from a quote line's charge periods. */
export function periodLabel(t: (k: string, p?: Record<string, string | number>) => string, count: number, unit: string | null): string {
  if (!unit) return '';
  return t('price.periods', { count, unit: t(`period.${unit}.${count === 1 ? 'one' : 'other'}`) });
}
