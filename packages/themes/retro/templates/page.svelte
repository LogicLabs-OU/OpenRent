<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import { display, wrap } from '../lib/retro.ts';

  let { data }: { data: PageData } = $props();
</script>

<div class={[wrap, 'py-12 md:py-16']}>
  <article class="max-w-3xl rounded-[0.25rem] border border-black bg-white p-6 md:p-10">
    <h1 class={[display, 'mb-8']}>{data.title}</h1>
    <div class="text-lg leading-8 whitespace-pre-wrap">{data.body}</div>
  </article>
</div>
