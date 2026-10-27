import compiled from './widget.css?inline';
import { call, type WidgetConfig } from './api.ts';

// `@property` rules are ignored inside shadow roots, so they are registered once on the document.
const PROPERTY = /@property\s+[^{]+\{[^}]*\}/g;
let registered = false;

export function registerProperties() {
  if (registered || typeof document === 'undefined') return;
  registered = true;
  const rules = compiled.match(PROPERTY)?.join('\n');
  if (!rules) return;
  const style = document.createElement('style');
  style.dataset.openrentWidget = '';
  style.textContent = rules;
  document.head.appendChild(style);
}

/** The stylesheet each widget element renders inside its shadow root. */
export const css = `<style>${compiled.replace(PROPERTY, '')}</style>`;

const themes = new Map<string, Promise<string>>();

/**
 * The live storefront theme's widget CSS (FR-THM-10), fetched once per shop. It comes after the
 * widget's own styles; rules the host page sets on the element still win. Empty when the theme has
 * none or the shop cannot be reached.
 */
export function themeCss(cfg: WidgetConfig): Promise<string> {
  const key = `${cfg.api}|${cfg.shop ?? ''}|${cfg.pk ?? ''}|${cfg.locale}`;
  if (!themes.has(key)) {
    themes.set(key, call<{ widget?: { css?: string } }>(cfg, `/settings?locale=${encodeURIComponent(cfg.locale)}`).then(
      (s) => (s.widget?.css ? `<style data-openrent-theme>${s.widget.css.replace(/<\/style/gi, '')}</style>` : ''),
      () => '',
    ));
  }
  return themes.get(key)!;
}
