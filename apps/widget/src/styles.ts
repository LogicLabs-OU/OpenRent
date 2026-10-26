import compiled from './widget.css?inline';

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
