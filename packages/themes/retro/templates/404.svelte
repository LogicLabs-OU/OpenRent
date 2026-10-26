<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import Coin from '../snippets/Coin.svelte';
  import { display, solid, wrap } from '../lib/retro.ts';

  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<div class={[wrap, 'py-16 md:py-24']}>
  <Empty.Root class="gap-8">
    <Empty.Header class="max-w-2xl gap-6">
      <Empty.Media><Coin letter="?" class="w-40 -rotate-12" /></Empty.Media>
      <Empty.Title><h1 class={display}>{rt.t('404.title')}</h1></Empty.Title>
      <Empty.Description class="text-foreground text-lg"
        >{rt.t('404.description', { path: data.path })}</Empty.Description
      >
    </Empty.Header>
    <Empty.Content><Button href={rt.url.home()} class={solid}>{rt.t('nav.all')}</Button></Empty.Content>
  </Empty.Root>
</div>
