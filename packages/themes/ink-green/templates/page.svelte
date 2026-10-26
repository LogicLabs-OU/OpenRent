<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import { h1 } from '../lib/ink.ts';

  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <h1 class={[h1, 'mb-8']}>{data.title}</h1>
  <div class="text-lg leading-relaxed whitespace-pre-wrap">{data.body}</div>
</article>
