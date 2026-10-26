<script lang="ts">
  import { themeFor } from '#lib/themes.ts';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
  const T = $derived(themeFor(data.themeId).templates['product']);
</script>

<T {data} />
