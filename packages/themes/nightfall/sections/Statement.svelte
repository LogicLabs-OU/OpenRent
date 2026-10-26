<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { accentParts } from '../lib/nightfall.ts';
  import { scrollProgress } from '../lib/motion.ts';

  /**
   * One large sentence whose words light up from dim to white as the visitor scrolls through it. The *starred*
   * words close it in the accent font with a hand-drawn underline that draws itself at the end.
   */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { text: string; label: string });
  const parts = $derived.by(() => {
    let i = 0;
    return accentParts(s.text).map((part) => ({
      accent: part.accent,
      words: part.text
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ w, i: i++ })),
    }));
  });
  const count = $derived(parts.reduce((n, p) => n + p.words.length, 0));
</script>

{#snippet word(w: { w: string; i: number })}<span class="nf-word" style:--i={w.i}>{w.w}</span>{' '}{/snippet}

{#if count}
  <section class="relative mx-auto mb-24 max-w-5xl py-10 text-center md:mb-36 md:py-20" data-section="statement">
    {#if s.label}<p class="mb-6 text-[0.8125rem] font-semibold text-white/60">{s.label}</p>{/if}
    <p
      class="nf-lit text-[2rem] leading-[1.2] font-semibold tracking-[-0.03em] text-balance sm:text-5xl md:text-[3.5rem]"
      style:--n={count}
      use:scrollProgress={{ from: 0.85, to: 0.25 }}
    >
      {#each parts as part, j (j)}{#if part.accent}<span class="nf-accent relative inline-block"
            >{#each part.words as w (w.i)}{@render word(w)}{/each}<svg
              class="absolute -bottom-[0.12em] left-0 h-[0.3em] w-[calc(100%-0.25em)] overflow-visible text-(--nf-accent)"
              viewBox="0 0 200 20"
              preserveAspectRatio="none"
              aria-hidden="true"
              ><path
                class="nf-stroke"
                d="M3 14 C 40 6, 90 4, 130 8 S 185 14, 197 6"
                pathLength="1"
                fill="none"
                stroke="currentColor"
                stroke-width="5"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              /></svg
            ></span
          >{' '}{:else}{#each part.words as w (w.i)}{@render word(w)}{/each}{/if}{/each}
    </p>
  </section>
{/if}
