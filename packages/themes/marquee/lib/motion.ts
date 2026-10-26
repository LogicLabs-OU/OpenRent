/** Small motion helpers. Nothing here hides content that is already on screen, and all of it stops for reduced motion. */

export const EASE = 'cubic-bezier(.645,.045,.355,1)';

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides an element up when it scrolls into view. Only elements that start below the fold are hidden first,
 * so the server HTML and the first screen never flash. `delay` staggers cards in a row.
 */
export function reveal(node: HTMLElement, delay = 0) {
  if (reducedMotion() || typeof IntersectionObserver === 'undefined') return;
  if (node.getBoundingClientRect().top < innerHeight) return;
  node.classList.add('mq-reveal', 'mq-pre');
  node.style.setProperty('--mq-delay', `${delay}ms`);
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      node.classList.remove('mq-pre');
      io.disconnect();
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}

/** Sets `data-scrolled` once the page has moved, read in a single animation frame per scroll burst. */
export function scrolled(node: HTMLElement) {
  let frame = 0;
  const update = () => {
    frame = 0;
    node.toggleAttribute('data-scrolled', scrollY > 8);
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  addEventListener('scroll', onScroll, { passive: true });
  return {
    destroy() {
      removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    },
  };
}

/** Counts a number up from zero in the element's text, keeping its width (e.g. "000" → "404"). */
export function countUp(node: HTMLElement, to: number) {
  if (reducedMotion()) return;
  const digits = String(to).length;
  const start = performance.now();
  const ms = 900;
  let frame = requestAnimationFrame(function tick(now) {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = String(Math.round(to * eased)).padStart(digits, '0');
    if (k < 1) frame = requestAnimationFrame(tick);
  });
  return { destroy: () => cancelAnimationFrame(frame) };
}
