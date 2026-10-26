<script lang="ts">
  import { goto } from '$app/navigation';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { StatusBadge, PageHeader } from '@openrent/ui/openrent';
  import SearchIcon from '@lucide/svelte/icons/search';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { api, qs, t, notifyError, fieldErrors, d } from '#lib';
  import { to } from '#lib/nav.ts';
  import ListExportMenu from '#lib/components/list-export-menu.svelte';

  let q = $state('');
  let rows = $state<any[]>([]);
  let open = $state(false);
  let form = $state({ name: '', email: '', phone: '', company_name: '' });
  let errors = $state<Record<string, string>>({});
  let dupes = $state<any[]>([]);
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    try {
      rows = (await api.get(`/customers?${qs({ q, limit: 100 })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  load();

  async function checkDupes() {
    dupes = !form.email && !form.phone ? [] : (await api.get(`/customers/duplicates?${qs({ email: form.email, phone: form.phone })}`)).data;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      const c = await api.post('/customers', { name: form.name, email: form.email || null, phone: form.phone || null, company_name: form.company_name || null, type: form.company_name ? 'company' : 'person' });
      open = false;
      goto(to(`/customers/${c.id}`));
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }
</script>

<svelte:head><title>{t('nav.customers')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.customers')} description={t('customers.description')}>
  {#snippet actions()}<ListExportMenu path="/customers/export" query={{ q }} /><Button onclick={() => { form = { name: '', email: '', phone: '', company_name: '' }; dupes = []; errors = {}; open = true; }}><UserPlusIcon />{t('customers.new')}</Button>{/snippet}
</PageHeader>

<div class="mb-4 flex justify-end">
  <InputGroup.Root class="w-full sm:w-72">
    <InputGroup.Input placeholder={t('customers.search')} bind:value={q} oninput={() => { clearTimeout(timer); timer = setTimeout(load, 200); }} aria-label={t('customers.search')} />
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
  </InputGroup.Root>
</div>

<div class="overflow-hidden rounded-lg border">
  <Table.Root>
    <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('field.name')}</Table.Head><Table.Head>{t('field.email')}</Table.Head><Table.Head>{t('field.phone')}</Table.Head><Table.Head>{t('customers.flags')}</Table.Head><Table.Head>{t('customers.since')}</Table.Head></Table.Row></Table.Header>
    <Table.Body>
      {#each rows as c (c.id)}
        <Table.Row class="cursor-pointer" onclick={() => goto(to(`/customers/${c.id}`))}>
          <Table.Cell class="font-medium"><a href={to(`/customers/${c.id}`)} class="hover:underline">{c.name}</a>{#if c.company_name && c.company_name !== c.name}<span class="font-normal text-muted-foreground"> · {c.company_name}</span>{/if}</Table.Cell>
          <Table.Cell>{c.email ?? ''}</Table.Cell>
          <Table.Cell>{c.phone ?? ''}</Table.Cell>
          <Table.Cell class="space-x-1">{#if c.flags.blocked}<StatusBadge status="blocked" label={t('customer.flag.blocked')} />{/if}{#if c.flags.deposit_waived}<Badge variant="secondary">{t('customer.flag.deposit_waived')}</Badge>{/if}</Table.Cell>
          <Table.Cell class="text-muted-foreground">{d(c.created_at)}</Table.Cell>
        </Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={5} class="h-24 text-center text-muted-foreground">{t('customers.empty')}</Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<Dialog.Root bind:open>
  <Dialog.Content>
    <form onsubmit={create}>
      <Dialog.Header><Dialog.Title>{t('customers.new')}</Dialog.Title><Dialog.Description>{t('customers.new_description')}</Dialog.Description></Dialog.Header>
      <Field.Group class="my-4 grid gap-4 sm:grid-cols-2">
        <Field.Field data-invalid={!!errors.name || undefined}><Field.Label for="cn">{t('field.name')}</Field.Label><Input id="cn" required bind:value={form.name} />{#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}</Field.Field>
        <Field.Field><Field.Label for="cc">{t('customers.company')}</Field.Label><Input id="cc" bind:value={form.company_name} /></Field.Field>
        <Field.Field data-invalid={!!errors.email || undefined}><Field.Label for="ce">{t('field.email')}</Field.Label><Input id="ce" type="email" bind:value={form.email} onblur={checkDupes} />{#if errors.email}<Field.Error>{errors.email}</Field.Error>{/if}</Field.Field>
        <Field.Field><Field.Label for="cp">{t('field.phone')}</Field.Label><Input id="cp" bind:value={form.phone} onblur={checkDupes} /></Field.Field>
      </Field.Group>
      {#if dupes.length}
        <Alert.Root class="mb-4">
          <TriangleAlertIcon />
          <Alert.Title>{t('customers.possible_duplicates')}</Alert.Title>
          <Alert.Description>{#each dupes as dpl (dpl.id)}<a class="block underline" href={to(`/customers/${dpl.id}`)}>{dpl.name} · {dpl.email ?? dpl.phone}</a>{/each}</Alert.Description>
        </Alert.Root>
      {/if}
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button type="submit" disabled={!form.name}>{t('common.create')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
