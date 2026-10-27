<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import { display, wrap } from '../lib/retro.ts';

  let { data }: { data: PageData } = $props();
</script>

<div class={[wrap, 'py-12 md:py-16']}>
  <article class="max-w-3xl rounded-[0.25rem] border border-black bg-white p-6 md:p-10">
    <h1 class={[display, 'mb-8']}>{data.title}</h1>
    {#if data.body_html}<div class="rich-text text-lg leading-8">
        {@html data.body_html}
      </div>{:else if data.body}<div class="text-lg leading-8 whitespace-pre-wrap">{data.body}</div>{/if}
  </article>
</div>
{#if data.sections?.length}<Sections sections={data.sections} products={data.products ?? []} />{/if}
