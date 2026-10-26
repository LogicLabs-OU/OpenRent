<script lang="ts">
  import type { PageData } from '@openrent/theme-sdk';
  let { data }: { data: PageData } = $props();
</script>

<article class="max-w-3xl">
  <h1 class="mb-6 text-3xl font-semibold tracking-tight">{data.title}</h1>
  <div class="text-muted-foreground leading-7 whitespace-pre-wrap">{data.body}</div>
</article>
