/**
 * Small scroll actions. Without JS, under reduced motion or with scroll effects switched off, everything stays
 * fully visible; an element is only hidden for a reveal when it is below the fold once the page is interactive.
 */
export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const off = (node: HTMLElement) => reducedMotion() || !!node.closest('[data-nf-motion="off"]');

/** Fades and lifts the element in when it scrolls into view; `delay` (ms) staggers siblings. */
export function reveal(node: HTMLElement, delay = 0) {
  if (off(node) || node.getBoundingClientRect().top < innerHeight) return;
  node.style.setProperty('--nf-delay', `${Math.min(delay, 600)}ms`);
  node.classList.add('nf-hidden');
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      node.classList.add('nf-shown');
      io.disconnect();
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}

/**
 * Writes the element's scroll progress to `--p` (0 → 1) while its top travels from `from` to `to`
 * (fractions of the viewport height). Starts at 1 (the finished look); an element already on screen
 * keeps that look until the visitor scrolls.
 */
export function scrollProgress(node: HTMLElement, opts: { from?: number; to?: number } = {}) {
  if (off(node)) return;
  const from = opts.from ?? 0.9;
  const to = opts.to ?? 0.3;
  let frame = 0;
  const update = () => {
    frame = 0;
    const top = node.getBoundingClientRect().top / innerHeight;
    const p = Math.min(1, Math.max(0, (from - top) / (from - to)));
    node.style.setProperty('--p', p.toFixed(4));
  };
  const queue = () => (frame ||= requestAnimationFrame(update));
  if (node.getBoundingClientRect().top >= innerHeight) update();
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  return {
    destroy() {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', queue);
      removeEventListener('resize', queue);
    },
  };
}
