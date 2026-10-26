<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import SearchXIcon from '@lucide/svelte/icons/search-x';
  import { h1 } from '../lib/ink.ts';

  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<Empty.Root>
  <Empty.Header>
    <Empty.Media variant="icon"><SearchXIcon /></Empty.Media>
    <Empty.Title><h1 class={h1}>{rt.t('404.title')}</h1></Empty.Title>
    <Empty.Description>{rt.t('404.description', { path: data.path })}</Empty.Description>
  </Empty.Header>
  <Empty.Content><Button href={rt.url.home()}>{rt.t('nav.all')}</Button></Empty.Content>
</Empty.Root>
