<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import PageHead from '../snippets/PageHead.svelte';

  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <PageHead title={data.title} />
  <div class="text-lg leading-[1.7] whitespace-pre-wrap text-white/75">{data.body}</div>
</article>
