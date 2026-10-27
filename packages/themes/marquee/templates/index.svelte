<script lang="ts">
  import type { IndexData } from '@openrent/theme-sdk';
  import Sections from '../snippets/Sections.svelte';
  import Intro from '../snippets/Intro.svelte';
  /** The home page is the shop's list of sections (Admin → Themes → Sections), opened by the intro count. */
  let { data }: { data: IndexData } = $props();
</script>

<Intro />
<Sections sections={data.sections ?? []} products={data.products} />
