/** Pure availability maths (PRD §7.4). Times are epoch milliseconds; `end` may be Infinity. */

export interface Span {
  start: number;
  end: number;
  quantity: number;
}

/**
 * Maximum concurrent allocated quantity within [from, to). Half-open: touching spans do not overlap.
 * A negative quantity is stock that is there only for a while (rented in, FR-CAT-9): it lowers the
 * count while it lasts, so `capacity - peak` is what is free at the tightest instant. The result can
 * be negative when such stock covers more than is booked.
 */
export function peakConcurrent(spans: Span[], from: number, to: number): number {
  const events: [number, number][] = [];
  for (const s of spans) {
    const a = Math.max(s.start, from);
    const b = Math.min(s.end, to);
    if (a >= b || s.quantity === 0) continue;
    events.push([a, s.quantity], [b, -s.quantity]);
  }
  events.sort((x, y) => x[0] - y[0]);
  let cur = 0;
  // Before the first change the count is zero, unless a change happens right at `from`.
  let peak = events.length && events[0]![0] === from ? Number.NEGATIVE_INFINITY : 0;
  for (let i = 0; i < events.length; ) {
    const t = events[i]![0];
    // Every change at one instant applies before it is counted.
    for (; i < events.length && events[i]![0] === t; i++) cur += events[i]![1];
    if (t < to && cur > peak) peak = cur;
  }
  return peak === Number.NEGATIVE_INFINITY ? 0 : peak;
}

/** Brute-force reference used by property tests: the count at every instant something changes. */
export function peakConcurrentNaive(spans: Span[], from: number, to: number): number {
  const points = new Set<number>([from]);
  for (const s of spans) {
    if (s.start >= from && s.start < to) points.add(s.start);
    if (s.end >= from && s.end < to) points.add(s.end);
  }
  let peak = Number.NEGATIVE_INFINITY;
  for (const t of points) {
    let cur = 0;
    for (const s of spans) if (s.start <= t && t < s.end && t >= from && t < to) cur += s.quantity;
    peak = Math.max(peak, cur);
  }
  return peak;
}

export function available(capacity: number, spans: Span[], from: number, to: number): number {
  return capacity - peakConcurrent(spans, from, to);
}

/** Bundle availability = min over components of floor(available / qty) (FR-CAT-5). */
export function bundleAvailable(components: { available: number; quantity: number; slot?: string | null }[]): number {
  if (components.length === 0) return 0;
  // Components in the same slot are alternatives (FR-CAT-6): the slot needs one of them, so the best counts.
  const fixed = components.filter((c) => !c.slot).map((c) => Math.floor(Math.max(0, c.available) / c.quantity));
  const slots = new Map<string, number>();
  for (const c of components.filter((x) => x.slot)) slots.set(c.slot!, Math.max(slots.get(c.slot!) ?? 0, Math.floor(Math.max(0, c.available) / c.quantity)));
  return Math.max(0, Math.min(...fixed, ...slots.values()));
}
