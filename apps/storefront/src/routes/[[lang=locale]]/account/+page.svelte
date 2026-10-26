<script lang="ts">
  import { templateFor } from '#lib/themes.ts';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
  const T = $derived(templateFor(data.themeId, 'account'));
</script>

<T {data} />
