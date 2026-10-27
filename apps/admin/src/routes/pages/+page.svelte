<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader, StatusBadge } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { api, t, toast, notifyError, fieldErrors, d } from '#lib';
  import { to } from '#lib/nav.ts';
  import StorefrontNavigation from '#lib/components/storefront-navigation.svelte';

  /** The shop's own storefront pages (about, contact, FAQ) and the storefront's menus. */
  let pages = $state<any[] | null>(null);
  let creating = $state<{ title: string; slug: string } | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  async function load() {
    pages = (await api.get('/storefront_pages')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!creating) return;
    saving = true;
    errors = {};
    try {
      const p = await api.post('/storefront_pages', { title: creating.title, ...(creating.slug.trim() ? { slug: creating.slug.trim() } : {}) });
      toast.success(t('pages.created'));
      creating = null;
      await goto(to(`/pages/${p.id}`));
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{t('nav.pages')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.pages')} description={t('pages.description')}>
  {#snippet actions()}<Button onclick={() => ((creating = { title: '', slug: '' }), (errors = {}))}><PlusIcon />{t('pages.new')}</Button>{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
  {#if !pages}
    <Spinner />
  {:else if !pages.length}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Media variant="icon"><FileTextIcon /></Empty.Media>
        <Empty.Title>{t('pages.empty')}</Empty.Title>
        <Empty.Description>{t('pages.empty_hint')}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Card.Root class="py-0">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('pages.page_title')}</Table.Head>
            <Table.Head>{t('pages.address')}</Table.Head>
            <Table.Head>{t('pages.status_label')}</Table.Head>
            <Table.Head>{t('pages.updated')}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each pages as p (p.id)}
            <Table.Row data-testid="page-row">
              <Table.Cell class="font-medium"><a class="hover:underline" href={to(`/pages/${p.id}`)}>{p.title}</a></Table.Cell>
              <Table.Cell class="text-muted-foreground font-mono text-xs">/pages/{p.slug}</Table.Cell>
              <Table.Cell><StatusBadge status={p.status} label={t(`pages.status.${p.status}` as any)} /></Table.Cell>
              <Table.Cell class="text-muted-foreground">{d(p.updated_at)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  {/if}

  <StorefrontNavigation />
</div>

<Dialog.Root open={!!creating} onOpenChange={(v) => !v && (creating = null)}>
  <Dialog.Content>
    {#if creating}
      <form class="flex flex-col gap-4" onsubmit={create}>
        <Dialog.Header><Dialog.Title>{t('pages.new')}</Dialog.Title></Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.title || undefined}>
            <Field.Label for="page-title">{t('pages.page_title')}</Field.Label>
            <Input id="page-title" bind:value={creating.title} aria-invalid={!!errors.title} />
            {#if errors.title}<Field.Error>{errors.title}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.slug || undefined}>
            <Field.Label for="page-slug">{t('pages.address')}</Field.Label>
            <Input id="page-slug" class="font-mono" placeholder={t('categories.slug_auto')} bind:value={creating.slug} aria-invalid={!!errors.slug} />
            {#if errors.slug}<Field.Error>{errors.slug}</Field.Error>{:else}<Field.Description>{t('pages.address_hint')}</Field.Description>{/if}
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (creating = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('pages.create')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
