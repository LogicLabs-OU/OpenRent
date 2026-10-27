<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <h1 class="mb-6 text-3xl font-semibold tracking-tight">{data.title}</h1>
  {#if data.body_html}<div class="rich-text text-muted-foreground leading-7">
      {@html data.body_html}
    </div>{:else if data.body}<div class="text-muted-foreground leading-7 whitespace-pre-wrap">
      {data.body}
    </div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
