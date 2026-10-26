<script lang="ts">
  import { page } from '$app/state';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { themeFor } from '#lib/themes.ts';
  import { t } from '#lib/i18n/index.ts';

  const T = $derived(themeFor((page.data as { themeId?: string })?.themeId).templates['404']);
</script>

{#if page.status === 404}
  <T data={{ path: page.url.pathname }} />
{:else}
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon"><CircleAlertIcon /></Empty.Media>
      <Empty.Title>{t('error.title')}</Empty.Title>
      <Empty.Description>{page.error?.message}</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href="/">{t('error.back_home')}</Button></Empty.Content>
  </Empty.Root>
{/if}
