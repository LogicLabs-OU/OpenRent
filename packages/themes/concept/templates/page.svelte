<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  import PageHeader from '../snippets/PageHeader.svelte';
  import { col } from '../lib/concept.ts';

  let { data }: { data: PageData } = $props();
</script>

<PageHeader title={data.title} icon="📄" />
<article class={col}><div class="max-w-[70ch] leading-7 whitespace-pre-wrap">{data.body}</div></article>
