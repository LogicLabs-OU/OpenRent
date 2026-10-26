<script lang="ts">
  import { tone } from '../lib/nightfall.ts';

  /** The stand-in for a missing product photo: a soft gradient in the product's colour family and its initial. */
  let { name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' } = $props();
</script>

<div class={['nf-art grid size-full place-items-center', `nf-tone-${tone(name)}`]} aria-hidden="true">
  <span
    class={[
      'font-semibold tracking-[-0.04em] text-white/85 drop-shadow-[0_8px_30px_rgba(0,0,0,0.45)]',
      size === 'lg' ? 'text-[9rem] md:text-[12rem]' : size === 'sm' ? 'text-xl' : 'text-7xl',
    ]}>{name.slice(0, 1).toUpperCase()}</span
  >
</div>
