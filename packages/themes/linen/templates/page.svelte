<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import Headline from '../snippets/Headline.svelte';
  import { h1 } from '../lib/linen.ts';

  let { data }: { data: PageData } = $props();
</script>

<article class="mx-auto flex max-w-3xl flex-col gap-10">
  <Headline tag="h1" text={data.title} mark={false} class={[h1, 'md:text-[4rem]']} />
  {#if data.body_html}<div
      class="rich-text rounded-[20px] bg-white p-6 text-lg leading-relaxed text-[#4d4d4d] md:p-12"
    >
      {@html data.body_html}
    </div>{:else if data.body}<div
      class="rounded-[20px] bg-white p-6 text-lg leading-relaxed whitespace-pre-wrap text-[#4d4d4d] md:p-12"
    >
      {data.body}
    </div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
