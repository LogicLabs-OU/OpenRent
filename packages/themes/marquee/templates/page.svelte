<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import Scribble from '../snippets/Scribble.svelte';
  import { h1 } from '../lib/marquee.ts';

  let { data }: { data: PageData } = $props();
</script>

<article class="mx-auto flex max-w-4xl flex-col gap-10">
  <h1 class={[h1, 'relative w-fit']}>{data.title}<Scribble /></h1>
  <div class="max-w-3xl text-xl leading-snug whitespace-pre-wrap">{data.body}</div>
</article>
