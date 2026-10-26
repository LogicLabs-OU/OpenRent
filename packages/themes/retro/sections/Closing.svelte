<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { display, solid, wrap } from '../lib/retro.ts';

  let { heading, button }: { heading: string; button: string } = $props();
  const rt = getRuntime();
</script>

<section class={[wrap, 'flex flex-col items-center gap-10 py-20 text-center md:py-28']}>
  <h2 class={[display, 'max-w-4xl lg:text-7xl']}>{heading}</h2>
  <Button href="#catalog" class={[solid, 'h-16 px-10 text-lg']}>{button || rt.t('closing.button')}</Button>
</section>
