<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import PageHeader from '../snippets/PageHeader.svelte';
  import { col } from '../lib/concept.ts';

  let { data }: { data: PageData } = $props();
</script>

<PageHeader title={data.title} icon="📄" />
<article class={col}>
  {#if data.body_html}<div class="rich-text max-w-[70ch] leading-7">
      {@html data.body_html}
    </div>{:else if data.body}<div class="max-w-[70ch] leading-7 whitespace-pre-wrap">{data.body}</div>{/if}
</article>
{#if data.sections?.length}<div class="mt-12">
    <Sections sections={data.sections} products={data.products ?? []} />
  </div>{/if}
