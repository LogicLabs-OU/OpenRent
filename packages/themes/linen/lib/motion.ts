/**
 * Linen's motion, as small Svelte actions. Nothing is hidden before hydration and nothing that is already on
 * screen gets hidden; with `prefers-reduced-motion: reduce` (or the theme's motion setting off) they do nothing.
 */
const calm = () => typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const off = () => calm() || !!document.querySelector('[data-ln-motion=off]');

type Kind = 'up' | 'lines' | 'clip';

/**
 * Reveal on scroll: `up` fades in from 20px lower, `lines` slides each `.ln-line` up from a clip mask and
 * `clip` wipes a media panel open. Only elements still below the fold after hydration are hidden first.
 */
export function reveal(node: HTMLElement, kind: Kind = 'up') {
  if (off() || typeof IntersectionObserver === 'undefined') return;
  if (node.getBoundingClientRect().top < innerHeight * 0.92) return;
  node.dataset.ln = kind;
  const io = new IntersectionObserver(
    (entries) => {
      // A fast scroll or a jump can carry it past the viewport between frames; show it then too.
      if (!entries.some((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)) return;
      node.classList.add('ln-in');
      io.disconnect();
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}

/** Calls `fn` at most once per frame while the page scrolls or resizes. */
function onScroll(fn: () => void) {
  let raf = 0;
  const tick = () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), fn()));
  };
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
  tick();
  return () => {
    removeEventListener('scroll', tick);
    removeEventListener('resize', tick);
    cancelAnimationFrame(raf);
  };
}

/**
 * Stacking panels: the container's `.ln-stack-item` children stick below the header, and the card inside the one
 * underneath shrinks and tilts back while the next slides over it. Tall panels stick by their bottom edge so all
 * of them can be read. Without JS the panels simply follow each other.
 */
export function stack(node: HTMLElement, enabled = true) {
  if (!enabled || typeof ResizeObserver === 'undefined') return;
  const items = [...node.querySelectorAll<HTMLElement>(':scope > .ln-stack-item')];
  if (items.length < 2) return;
  const tilt = !off();
  node.dataset.stack = 'on';
  const measure = () => {
    const header = document.querySelector<HTMLElement>('[data-ln-header]')?.offsetHeight ?? 72;
    items.forEach((el, i) => {
      el.style.top = `${Math.min(header + 16 + i * 14, innerHeight - el.offsetHeight - 16)}px`;
    });
  };
  const update = () => {
    if (!tilt) return;
    const r = items.map((el) => el.getBoundingClientRect());
    items.forEach((el, i) => {
      const next = r[i + 1];
      const inner = el.firstElementChild as HTMLElement | null;
      if (!next || !inner) return;
      const p = Math.min(1, Math.max(0, (r[i]!.bottom - next.top) / r[i]!.height));
      inner.style.transform = p
        ? `perspective(1600px) rotateX(${(p * 10).toFixed(2)}deg) scale(${(1 - p * 0.08).toFixed(4)})`
        : '';
      inner.style.setProperty('--ln-shade', (p * 0.12).toFixed(3));
    });
  };
  const ro = new ResizeObserver(measure);
  items.forEach((el) => ro.observe(el));
  addEventListener('resize', measure);
  const stop = onScroll(update);
  return {
    destroy() {
      stop();
      ro.disconnect();
      removeEventListener('resize', measure);
      delete node.dataset.stack;
      for (const el of items) {
        el.style.top = '';
        (el.firstElementChild as HTMLElement | null)?.style.removeProperty('transform');
      }
    },
  };
}

/**
 * Moves an element against the scroll by `speed` × its distance from the viewport centre, measured on its
 * offset parent (so the shift never feeds back) and capped at half a viewport.
 */
export function parallax(node: HTMLElement, speed = 0.08) {
  if (off()) return;
  const stop = onScroll(() => {
    const r = (node.offsetParent ?? node).getBoundingClientRect();
    const d = Math.max(-innerHeight / 2, Math.min(innerHeight / 2, r.top + r.height / 2 - innerHeight / 2));
    node.style.setProperty('--ln-py', `${(-d * speed).toFixed(1)}px`);
  });
  return { destroy: stop };
}
