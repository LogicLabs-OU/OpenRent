<script lang="ts">
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { t } from './i18n/index.ts';

  /** The ID check the shop needs before pickup (FR-PAY-9), done on the check service's page. */
  type Check = { required: boolean; verified: boolean; status: string | null; url: string | null; reason: string | null };
  const check = $derived((page.data.account as { id_check?: Check } | undefined)?.id_check);
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  let busy = $state(false);
  let failed = $state('');

  async function start() {
    busy = true;
    failed = '';
    try {
      const res = await fetch('/_or/account/id-check', { method: 'POST', headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.message ?? tr('account.id_check.unavailable'));
      window.location.href = body.url;
    } catch (err) {
      failed = (err as Error).message;
      busy = false;
    }
  }
</script>

{#if check?.required}
  <Card.Root data-testid="account-id-check">
    <Card.Header>
      <Card.Title>{tr('account.id_check.title')}</Card.Title>
      <Card.Description>{check.verified ? tr('account.id_check.verified') : check.status === 'failed' ? tr('account.id_check.failed') : tr('account.id_check.hint')}</Card.Description>
    </Card.Header>
    {#if !check.verified}
      <Card.Content class="flex flex-col gap-2">
        <Button class="w-fit" disabled={busy} onclick={start}>{#if busy}<Spinner />{/if}{tr('account.id_check.start')}</Button>
        {#if failed}<p class="text-sm text-destructive" role="alert">{failed}</p>{/if}
      </Card.Content>
    {/if}
  </Card.Root>
{/if}
