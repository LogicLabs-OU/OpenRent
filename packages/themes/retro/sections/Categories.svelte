<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { STICKERS, display, pill, wrap } from '../lib/retro.ts';

  let { heading, text }: { heading: string; text: string } = $props();
  const rt = getRuntime();
</script>

<section class={[wrap, 'flex flex-col items-center gap-10 py-20 text-center md:py-28']}>
  <div class="flex flex-col gap-4">
    <h2 class={display}>{heading}</h2>
    {#if text}<p class="text-lg md:text-xl">{text}</p>{/if}
  </div>
  <ul class="flex max-w-4xl flex-wrap justify-center gap-3">
    {#each rt.shop.categories as c, i (c.id)}
      <li>
        <Button href={rt.url.category(c.slug)} class={[pill, 'gap-3 md:text-xl']}>
          <span
            class="size-5 shrink-0 rotate-12 rounded-[0.3rem] border border-black"
            style:background={STICKERS[i % STICKERS.length]}
            aria-hidden="true"
          ></span>{c.name}
        </Button>
      </li>
    {/each}
  </ul>
</section>
