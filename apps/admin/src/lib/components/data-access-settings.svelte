<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as Dialog from '@openrent/ui/dialog';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import { api, t, toast, notifyError, fieldErrors, rel, confirmAction } from '#lib';

  /** Database logins for BI tools (FR-REP-5): Metabase, Power BI or Looker Studio read the shop's views. */
  let access = $state<any>(null);
  let open = $state(false);
  let name = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let shown = $state<any>(null);

  async function load() {
    try {
      access = await api.get('/bi_access');
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      shown = await api.post('/bi_access', { name });
      name = '';
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function rotate(l: any) {
    if (!(await confirmAction({ title: t('bi.rotate_title', { name: l.name }), description: t('bi.rotate_description'), confirmLabel: t('bi.rotate') }))) return;
    try {
      shown = await api.post(`/bi_access/${l.id}/actions/rotate`, {});
      open = true;
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function revoke(l: any) {
    if (!(await confirmAction({ title: t('bi.revoke_title', { name: l.name }), description: t('bi.revoke_description'), confirmLabel: t('settings.revoke'), destructive: true }))) return;
    try {
      await api.del(`/bi_access/${l.id}`);
      toast.success(t('bi.revoked'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function copy(v: string) {
    await navigator.clipboard.writeText(v).catch(() => undefined);
    toast.success(t('common.copied'));
  }

  const details = (s: any) =>
    s?.connection
      ? [
          ['host', t('bi.host'), s.connection.host],
          ['port', t('bi.port'), String(s.connection.port)],
          ['database', t('bi.database'), s.connection.database],
          ['sslmode', t('bi.ssl'), s.connection.sslmode],
        ]
      : [];
</script>

<Card.Root data-testid="data-access">
  <Card.Header>
    <Card.Title>{t('settings.tab.data_access')}</Card.Title>
    <Card.Description>{t('bi.description')}</Card.Description>
    {#if access?.available}
      <Card.Action>
        <Button
          disabled={access.data.length >= access.max_logins}
          onclick={() => {
            shown = null;
            errors = {};
            open = true;
          }}><PlusIcon />{t('bi.new')}</Button
        >
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if !access}
      <Spinner />
    {:else}
      {#if access.problem}
        <Alert.Root data-testid="data-access-problem">
          <DatabaseIcon />
          <Alert.Title>{t('bi.unavailable')}</Alert.Title>
          <Alert.Description>{access.problem.message}</Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root>
          <ShieldAlertIcon />
          <Alert.Title>{t('bi.secret_title')}</Alert.Title>
          <Alert.Description>{t('bi.secret_hint')}</Alert.Description>
        </Alert.Root>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm" data-testid="data-access-connection">
          {#each details(access) as [key, label, value] (key)}
            <dt class="text-muted-foreground">{label}</dt>
            <dd class="font-mono">{value}</dd>
          {/each}
          <dt class="text-muted-foreground">{t('bi.views')}</dt>
          <dd class="font-mono text-xs">{access.views.join(', ')}</dd>
        </dl>
      {/if}
      {#if access.data.length}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{t('field.name')}</Table.Head>
              <Table.Head>{t('bi.username')}</Table.Head>
              <Table.Head>{t('bi.password_set')}</Table.Head>
              <Table.Head class="w-48"><span class="sr-only">{t('bi.actions')}</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each access.data as l (l.id)}
              <Table.Row data-testid="data-access-login">
                <Table.Cell class="font-medium">{l.name}</Table.Cell>
                <Table.Cell><code class="text-xs">{l.username}</code></Table.Cell>
                <Table.Cell class="text-muted-foreground text-sm">{rel(l.rotated_at ?? l.created_at)}</Table.Cell>
                <Table.Cell class="text-right">
                  {#if access.available}<Button size="sm" variant="ghost" onclick={() => rotate(l)}>{t('bi.rotate')}</Button>{/if}
                  <Button size="sm" variant="ghost" onclick={() => revoke(l)}>{t('settings.revoke')}</Button>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {:else if access.available}
        <p class="text-muted-foreground flex items-center gap-2 text-sm"><DatabaseIcon class="size-4" />{t('bi.none')}</p>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open>
  <Dialog.Content>
    {#if shown}
      <Dialog.Header>
        <Dialog.Title>{t('bi.created_title', { name: shown.name })}</Dialog.Title>
        <Dialog.Description>{t('bi.created_hint')}</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        {#each [['username', t('bi.username'), shown.username], ['password', t('bi.password'), shown.password]] as [key, label, value] (key)}
          <Field.Field>
            <Field.Label for={`bi-${key}`}>{label}</Field.Label>
            <InputGroup.Root>
              <InputGroup.Input id={`bi-${key}`} readonly {value} data-testid={`data-access-${key}`} class="font-mono" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
              <InputGroup.Addon align="inline-end"><InputGroup.Button aria-label={t('bi.copy', { what: label })} onclick={() => copy(value)}><CopyIcon /></InputGroup.Button></InputGroup.Addon>
            </InputGroup.Root>
          </Field.Field>
        {/each}
      </Field.Group>
      <Dialog.Footer><Button onclick={() => (open = false)}>{t('common.done')}</Button></Dialog.Footer>
    {:else}
      <form class="flex flex-col gap-4" onsubmit={create}>
        <Dialog.Header>
          <Dialog.Title>{t('bi.new')}</Dialog.Title>
          <Dialog.Description>{t('bi.new_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Field data-invalid={!!errors.name || undefined}>
          <Field.Label for="bi-name">{t('field.name')}</Field.Label>
          <Input id="bi-name" placeholder={t('bi.name_placeholder')} bind:value={name} aria-invalid={!!errors.name} />
          {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
        </Field.Field>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.create')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
