<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import PageHead from '../snippets/PageHead.svelte';

  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <PageHead title={data.title} />
  {#if data.body_html}<div class="rich-text text-lg leading-[1.7] text-white/75">
      {@html data.body_html}
    </div>{:else if data.body}<div class="text-lg leading-[1.7] whitespace-pre-wrap text-white/75">
      {data.body}
    </div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
