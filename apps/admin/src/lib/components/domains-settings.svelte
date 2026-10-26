<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { api, t, toast, notifyError, fieldErrors, rel, confirmAction } from '#lib';

  /** Settings → Domains (FR-SF-1): the shop's own storefront domains and the DNS records that prove them. */
  let list = $state<any[]>([]);
  let hostname = $state('');
  let errors = $state<Record<string, string>>({});
  let adding = $state(false);
  let checking = $state<string | null>(null);

  async function load() {
    list = (await api.get('/storefront_domains')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function add(e: SubmitEvent) {
    e.preventDefault();
    adding = true;
    errors = {};
    try {
      await api.post('/storefront_domains', { hostname });
      hostname = '';
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      adding = false;
    }
  }

  async function check(d: any) {
    checking = d.id;
    try {
      const r = await api.post(`/storefront_domains/${d.id}/actions/verify`, {});
      if (r.status === 'verified') toast.success(t('domains.verified_toast', { host: r.hostname }));
      else toast.error(r.last_error ?? t('domains.not_yet'));
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      checking = null;
    }
  }

  async function primary(d: any) {
    try {
      await api.post(`/storefront_domains/${d.id}/actions/make_primary`, {});
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function remove(d: any) {
    if (!(await confirmAction({ title: t('domains.remove_title', { host: d.hostname }), description: t('domains.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/storefront_domains/${d.id}`);
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toast.success(t('calendar.copied'));
  }
</script>

<Card.Root data-testid="domains">
  <Card.Header>
    <Card.Title>{t('domains.title')}</Card.Title>
    <Card.Description>{t('domains.hint')}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <form class="flex items-start gap-2" onsubmit={add}>
      <Field.Field class="flex-1" data-invalid={!!errors.hostname || undefined}>
        <Field.Label for="dom-host" class="sr-only">{t('domains.hostname')}</Field.Label>
        <Input id="dom-host" placeholder="shop.example.com" autocomplete="off" bind:value={hostname} aria-invalid={!!errors.hostname} />
        {#if errors.hostname}<Field.Error>{errors.hostname}</Field.Error>{/if}
      </Field.Field>
      <Button type="submit" disabled={adding || !hostname.trim()}>{#if adding}<Spinner />{:else}<GlobeIcon />{/if}{t('domains.add')}</Button>
    </form>

    {#each list as d (d.id)}
      <div class="flex flex-col gap-3 rounded-lg border p-4" data-testid="domain-row">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{d.hostname}</span>
          <Badge variant={d.status === 'verified' ? 'secondary' : d.status === 'failed' ? 'destructive' : 'outline'}>{t(`domains.status.${d.status}` as any)}</Badge>
          {#if d.is_primary}<Badge>{t('domains.primary')}</Badge>{/if}
          <div class="ml-auto flex gap-1">
            {#if d.status !== 'verified'}<Button size="sm" variant="outline" disabled={checking === d.id} onclick={() => check(d)}>{#if checking === d.id}<Spinner />{:else}<RefreshCwIcon />{/if}{t('domains.check')}</Button>{/if}
            {#if d.status === 'verified' && !d.is_primary}<Button size="sm" variant="ghost" onclick={() => primary(d)}>{t('domains.make_primary')}</Button>{/if}
            <Button size="sm" variant="ghost" onclick={() => remove(d)}>{t('common.remove')}</Button>
          </div>
        </div>
        {#if d.status !== 'verified'}
          <p class="text-muted-foreground text-sm">{t('domains.dns_hint')}</p>
          <Table.Root>
            <Table.Header><Table.Row><Table.Head>{t('domains.dns.type')}</Table.Head><Table.Head>{t('domains.dns.name')}</Table.Head><Table.Head>{t('domains.dns.value')}</Table.Head></Table.Row></Table.Header>
            <Table.Body>
              {#each [['TXT', d.dns.txt.name, d.dns.txt.value], ['CNAME', d.dns.cname.name, d.dns.cname.target]] as [type, name, value] (type)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{type}</Table.Cell>
                  <Table.Cell class="font-mono text-xs break-all">{name}</Table.Cell>
                  <Table.Cell>
                    <InputGroup.Root>
                      <InputGroup.Input readonly value={value} class="font-mono text-xs" aria-label={`${type} ${t('domains.dns.value')}`} data-testid={`dns-${type.toLowerCase()}`} />
                      <InputGroup.Addon align="inline-end"><InputGroup.Button onclick={() => copy(value)} aria-label={t('calendar.copy')}><CopyIcon /></InputGroup.Button></InputGroup.Addon>
                    </InputGroup.Root>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
          {#if d.last_error}<p class="text-destructive text-sm">{d.last_error}</p>{/if}
        {/if}
        {#if d.last_checked_at}<p class="text-muted-foreground text-xs">{t('domains.last_checked', { when: rel(d.last_checked_at) })}</p>{/if}
      </div>
    {:else}
      <p class="text-muted-foreground text-sm">{t('domains.none')}</p>
    {/each}
  </Card.Content>
</Card.Root>
