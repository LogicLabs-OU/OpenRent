<script lang="ts">
  import { getRuntime, type VariantPrice } from '@openrent/theme-sdk';

  /** The accent-coloured tag with a notched end that carries a price. */
  let { price, size = 'md' }: { price: VariantPrice; size?: 'md' | 'lg' } = $props();
  const rt = getRuntime();
  const amount = $derived(rt.format.money(price.amount));
  const label = $derived(
    price.kind === 'fixed'
      ? amount
      : rt.t('price.per', { amount, unit: rt.t(`period.${price.period_unit}.one`) }),
  );
  const notch = '[clip-path:polygon(0_0,100%_0,calc(100%-0.75rem)_50%,100%_100%,0_100%)]';
</script>

<span class={['inline-flex bg-black p-px pr-[2px] align-middle', notch]}>
  <span
    class={[
      'bg-(--retro-accent) text-(--retro-accent-ink) inline-flex items-center pr-6 tabular-nums',
      notch,
      size === 'lg' ? 'py-1.5 pl-3 text-lg' : 'py-1 pl-2 text-base',
    ]}>{label}</span
  >
</span>
