<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import Scribble from '../snippets/Scribble.svelte';
  import { h1 } from '../lib/marquee.ts';

  let { data }: { data: PageData } = $props();
</script>

<article class="mx-auto flex max-w-4xl flex-col gap-10">
  <h1 class={[h1, 'relative w-fit']}>{data.title}<Scribble /></h1>
  {#if data.body_html}<div class="rich-text max-w-3xl text-xl leading-snug">
      {@html data.body_html}
    </div>{:else if data.body}<div class="max-w-3xl text-xl leading-snug whitespace-pre-wrap">
      {data.body}
    </div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
