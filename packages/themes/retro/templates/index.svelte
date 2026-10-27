<script lang="ts">
  import type { IndexData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  /** The home page is the shop's list of sections (Admin → Themes → Sections). */
  let { data }: { data: IndexData } = $props();
</script>

<Sections sections={data.sections ?? []} products={data.products} />
