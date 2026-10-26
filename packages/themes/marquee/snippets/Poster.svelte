<script lang="ts">
  import { hash } from '../lib/marquee.ts';

  /**
   * The stand-in for a missing photo: a bold gig poster in blue, orange or grey with halftone dots, stripes
   * or rules, a giant outlined initial and the name set big at the bottom. Purely decorative.
   */
  let { name, tag = '', big = false }: { name: string; tag?: string; big?: boolean } = $props();
  const n = $derived(hash(name));
  const TONES = [
    'bg-(--mq-accent) text-(--mq-on-accent) [--mq-stroke:var(--mq-on-accent)] [--mq-misprint:var(--mq-ink)]',
    'bg-(--mq-accent-2) text-(--mq-on-accent-2) [--mq-stroke:var(--mq-on-accent-2)] [--mq-misprint:#fff]',
    'bg-(--mq-grey) text-(--mq-ink) [--mq-stroke:var(--mq-ink)] [--mq-misprint:var(--mq-accent)]',
  ];
  const PATTERNS = ['mq-halftone', 'mq-stripes', 'mq-rules'];
  const tone = $derived(TONES[n % 3]);
  const pattern = $derived(PATTERNS[(n >> 3) % 3]);
  const initial = $derived([...name.trim()][0]?.toUpperCase() ?? '');
</script>

<div class={['relative flex size-full flex-col justify-between overflow-hidden p-4 md:p-5', tone]} aria-hidden="true">
  <div class={['absolute inset-0', pattern]}></div>
  <span class="mq-mono relative flex justify-between gap-3 text-[0.6875rem] tracking-[0.06em] uppercase"
    ><span>{tag}</span><span>#{String(n % 1000).padStart(3, '0')}</span></span
  >
  {#if big}
    <span
      class="mq-outline mq-tight pointer-events-none absolute top-[0.08em] right-[0.06em] text-[clamp(14rem,30vw,26rem)] leading-[0.74] font-extrabold"
      >{initial}</span
    >
    <span class="mq-tight relative line-clamp-3 text-[clamp(2.75rem,6vw,5.5rem)] leading-[0.86] font-extrabold break-words uppercase"
      >{name}</span
    >
  {:else}
    <!-- A solid initial with an outlined copy knocked off register, like a cheap two-colour print. -->
    <span class="relative self-start">
      <span class="mq-tight block text-[clamp(9rem,15vw,13rem)] leading-[0.74] font-extrabold">{initial}</span>
      <span
        class="mq-outline mq-tight absolute top-[0.05em] left-[0.07em] [--mq-stroke:var(--mq-misprint)] block text-[clamp(9rem,15vw,13rem)] leading-[0.74] font-extrabold"
        >{initial}</span
      >
    </span>
  {/if}
</div>
