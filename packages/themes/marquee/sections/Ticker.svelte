<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';

  /**
   * A running strip like a venue's news ticker: the shop's categories (or your own words) in big condensed
   * capitals, separated by stars, moving sideways forever. Hover or focus pauses it; reduced motion stops it.
   */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { text: string; tone: 'blue' | 'orange' | 'ink'; speed: number });
  const words = $derived.by(() => {
    const own = String(s.text ?? '')
      .split(/\n|·|\|/)
      .map((w) => w.trim())
      .filter(Boolean);
    const list = own.length ? own : rt.shop.categories.map((c) => c.name);
    return list.length ? list : [rt.shop.tenant.name];
  });
  // Enough repeats to overfill a wide screen, so the second copy joins without a gap.
  const run = $derived(Array.from({ length: Math.max(2, Math.ceil(12 / words.length)) }, () => words).flat());
  const TONES = {
    blue: 'bg-(--mq-accent) text-(--mq-on-accent) border-(--mq-accent) [--mq-stroke:var(--mq-on-accent)]',
    orange: 'bg-(--mq-accent-2) text-(--mq-on-accent-2) border-(--mq-accent-2) [--mq-stroke:var(--mq-on-accent-2)]',
    ink: 'bg-(--mq-ink) text-(--mq-paper) border-(--mq-ink) [--mq-stroke:var(--mq-paper)]',
  };
</script>

<section
  class={[
    'mq-ticker -mx-4 mb-16 overflow-hidden border-y py-3 md:-mx-10 md:mb-24 md:py-4',
    TONES[s.tone] ?? TONES.blue,
  ]}
  style:--mq-speed={`${Math.max(10, Number(s.speed) || 40)}s`}
  role="marquee"
  aria-label={words.join(', ')}
  data-section="ticker"
>
  <div class="mq-ticker-track" aria-hidden="true">
    {#each [0, 1] as copy (copy)}
      <div class="mq-ticker-copy flex shrink-0 items-center">
        {#each run as w, i (i)}<span
            class={[
              'mq-tight px-6 text-[clamp(2rem,4.4vw,3.75rem)] leading-none font-bold whitespace-nowrap uppercase md:px-8',
              i % 2 === 1 && 'mq-outline',
            ]}>{w}</span
          ><span class="text-[clamp(1.25rem,2.4vw,2rem)] leading-none" aria-hidden="true">✶</span>{/each}
      </div>
    {/each}
  </div>
</section>
