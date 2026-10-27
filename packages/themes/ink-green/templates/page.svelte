<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import { h1 } from '../lib/ink.ts';

  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <h1 class={[h1, 'mb-8']}>{data.title}</h1>
  {#if data.body_html}<div class="rich-text text-lg leading-relaxed">
      {@html data.body_html}
    </div>{:else if data.body}<div class="text-lg leading-relaxed whitespace-pre-wrap">{data.body}</div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
