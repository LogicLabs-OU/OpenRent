/** Pure availability maths (PRD §7.4). Times are epoch milliseconds; `end` may be Infinity. */

export interface Span {
  start: number;
  end: number;
  quantity: number;
}

/** Maximum concurrent allocated quantity within [from, to). Half-open: touching spans do not overlap. */
export function peakConcurrent(spans: Span[], from: number, to: number): number {
  const events: [number, number][] = [];
  for (const s of spans) {
    const a = Math.max(s.start, from);
    const b = Math.min(s.end, to);
    if (a >= b || s.quantity <= 0) continue;
    events.push([a, s.quantity], [b, -s.quantity]);
  }
  // Ends sort before starts at the same instant.
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

/** Brute-force reference used by property tests. */
export function peakConcurrentNaive(spans: Span[], from: number, to: number): number {
  const points = new Set<number>([from]);
  for (const s of spans) {
    if (s.start >= from && s.start < to) points.add(s.start);
  }
  let peak = 0;
  for (const t of points) {
    let cur = 0;
    for (const s of spans) if (s.start <= t && t < s.end && s.quantity > 0 && t >= from && t < to) cur += s.quantity;
    peak = Math.max(peak, cur);
  }
  return peak;
}

export function available(capacity: number, spans: Span[], from: number, to: number): number {
  return capacity - peakConcurrent(spans, from, to);
}

/** Bundle availability = min over components of floor(available / qty) (FR-CAT-5). */
export function bundleAvailable(components: { available: number; quantity: number }[]): number {
  if (components.length === 0) return 0;
  return Math.max(0, Math.min(...components.map((c) => Math.floor(Math.max(0, c.available) / c.quantity))));
}
