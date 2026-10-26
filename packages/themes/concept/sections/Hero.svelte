<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import PageHeader from '../snippets/PageHeader.svelte';
  import { coverFor } from '../lib/concept.ts';

  /** The home page's header: cover, icon, title and a line of text. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(
    section.settings as { heading: string; text: string; icon: string; cover: string; show_cover: boolean },
  );
</script>

<PageHeader
  title={s.heading}
  icon={s.icon}
  coverImage={s.cover}
  cover={s.show_cover === false ? '' : coverFor(section.id)}
  description={s.text}
/>
