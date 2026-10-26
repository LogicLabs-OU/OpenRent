<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import PageHeader from '../snippets/PageHeader.svelte';
  import { col } from '../lib/concept.ts';

  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<PageHeader title={rt.t('404.title')} icon="🧭" description={rt.t('404.description', { path: data.path })} />
<div class={col}><Button href={rt.url.home()}>{rt.t('nav.home')}</Button></div>
