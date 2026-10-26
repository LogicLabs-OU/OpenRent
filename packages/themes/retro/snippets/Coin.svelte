<script lang="ts">
  /** A thick, tilted coin stamped with a letter: a decoration only, hidden from screen readers. */
  let { letter = '', class: className = '' }: { letter?: string; class?: string } = $props();

  const rx = 52;
  const ry = 30;
  const dx = 7;
  const dy = 11;
  // Points where the edge of the coin meets its rim: the ellipse tangents parallel to the depth vector.
  const t = Math.atan2(-ry * dx, rx * dy);
  const p1 = [60 + rx * Math.cos(t), 40 + ry * Math.sin(t)] as const;
  const p2 = [60 - rx * Math.cos(t), 40 - ry * Math.sin(t)] as const;
  const rim = `M${p1[0]},${p1[1]} L${p1[0] + dx},${p1[1] + dy} L${p2[0] + dx},${p2[1] + dy} L${p2[0]},${p2[1]} Z`;
</script>

<svg class={className} viewBox="0 0 128 92" aria-hidden="true" focusable="false">
  <g fill="var(--retro-accent)" stroke="#000" stroke-width="1.6">
    <ellipse cx={60 + dx} cy={40 + dy} {rx} {ry} />
    <path d={rim} stroke="none" />
    <line x1={p1[0]} y1={p1[1]} x2={p1[0] + dx} y2={p1[1] + dy} />
    <line x1={p2[0]} y1={p2[1]} x2={p2[0] + dx} y2={p2[1] + dy} />
    <ellipse cx="60" cy="40" {rx} {ry} />
  </g>
  {#if letter}
    <text
      x="60"
      y="40"
      transform="translate(60 40) scale(1 0.62) translate(-60 -40)"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="52"
      font-weight="800"
      fill="#000"
      style="font-family:inherit">{letter}</text
    >
  {/if}
</svg>
