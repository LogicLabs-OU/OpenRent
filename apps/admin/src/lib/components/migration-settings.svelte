<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge } from '@openrent/ui/openrent';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, upload, t, toast, notifyError, fieldErrors, dt } from '#lib';
  import ImportReport from './import-report.svelte';

  /**
   * Moving to OpenRent (FR-MIG-2): Shelf.nu from its CSV export, Booqable and Snipe-IT through their
   * APIs. What they hold is read into one import per kind of record and checked together; the shop
   * looks at the result and applies it all at once.
   */
  type Source = 'shelf' | 'booqable' | 'snipeit';
  let source = $state<Source>('booqable');
  let form = $state({ company: '', base_url: '', api_key: '' });
  let file = $state<File | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let batch = $state<any>(null);
  let recent = $state<any[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function loadRecent() {
    recent = (await api.get('/import_batches')).data;
  }
  loadRecent().catch(notifyError);
  onDestroy(() => clearTimeout(timer));

  /** Reading and applying run in the background: the batch is asked again until it is done. */
  async function follow(id: string) {
    clearTimeout(timer);
    batch = await api.get(`/import_batches/${id}`);
    if (batch.status === 'fetching' || batch.status === 'applying') timer = setTimeout(() => follow(id).catch(notifyError), 1500);
    else {
      if (batch.status === 'applied') toast.success(t('migration.applied'));
      loadRecent().catch(notifyError);
    }
  }

  async function start(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    busy = true;
    try {
      const body: Record<string, unknown> = { source };
      if (source === 'shelf') {
        if (!file) {
          errors = { file_id: t('migration.choose_file') };
          return;
        }
        body.file_id = (await upload('/files?purpose=import', file)).id;
      } else {
        body.api_key = form.api_key;
        if (source === 'booqable') body.company = form.company.trim() || undefined;
        else body.base_url = form.base_url.trim();
      }
      const b = await api.post('/import_batches', body);
      form.api_key = '';
      await follow(b.id);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function apply() {
    busy = true;
    try {
      await api.post(`/import_batches/${batch.id}/actions/apply`);
      await follow(batch.id);
    } catch (err) {
      notifyError(err);
    } finally {
      busy = false;
    }
  }

  const STATUS: Record<string, string> = { fetching: 'pending', validated: 'available', applying: 'pending', applied: 'completed', failed: 'failed' };
  const errorCount = $derived(batch ? batch.imports.reduce((n: number, i: any) => n + i.error_count, 0) : 0);
  const changes = $derived(batch ? batch.imports.reduce((n: number, i: any) => n + i.report.counts.create + i.report.counts.update, 0) : 0);
</script>

<Card.Root data-testid="migration">
  <Card.Header>
    <Card.Title>{t('migration.title')}</Card.Title>
    <Card.Description>{t('migration.hint')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-6" onsubmit={start}>
      <Field.Field>
        <Field.Label id="mig-source-label">{t('migration.source')}</Field.Label>
 <!-- i18n-ignore -->
        <ToggleGroup.Root type="single" variant="outline" value={source} onValueChange={(v) => v && (source = v as Source)} aria-labelledby="mig-source-label">
          <ToggleGroup.Item value="booqable">Booqable</ToggleGroup.Item>
          <ToggleGroup.Item value="snipeit">Snipe-IT</ToggleGroup.Item>
          <ToggleGroup.Item value="shelf">Shelf.nu</ToggleGroup.Item>
        </ToggleGroup.Root>
        <Field.Description>{t(`migration.source_hint.${source}`)}</Field.Description>
      </Field.Field>
      {#if source === 'shelf'}
        <Field.Field data-invalid={!!errors.file_id || undefined}>
          <Field.Label for="mig-file">{t('migration.shelf_file')}</Field.Label>
          <Input id="mig-file" type="file" accept=".csv,text/csv" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} aria-invalid={!!errors.file_id} />
          {#if errors.file_id}<Field.Error>{errors.file_id}</Field.Error>{/if}
        </Field.Field>
      {:else}
        <div class="grid gap-6 sm:grid-cols-2">
          {#if source === 'booqable'}
            <Field.Field data-invalid={!!errors.company || undefined}>
              <Field.Label for="mig-company">{t('migration.booqable_company')}</Field.Label>
              <!-- i18n-ignore --><Input id="mig-company" placeholder="rentals" bind:value={form.company} aria-invalid={!!errors.company} />
              {#if errors.company}<Field.Error>{errors.company}</Field.Error>{:else}<Field.Description>{t('migration.booqable_company_hint')}</Field.Description>{/if}
            </Field.Field>
          {:else}
            <Field.Field data-invalid={!!errors.base_url || undefined}>
              <Field.Label for="mig-url">{t('migration.snipeit_url')}</Field.Label>
              <Input id="mig-url" type="url" placeholder="https://assets.example.com" bind:value={form.base_url} aria-invalid={!!errors.base_url} />
              {#if errors.base_url}<Field.Error>{errors.base_url}</Field.Error>{/if}
            </Field.Field>
          {/if}
          <Field.Field data-invalid={!!errors.api_key || undefined}>
            <Field.Label for="mig-key">{t(source === 'booqable' ? 'migration.api_key' : 'migration.api_token')}</Field.Label>
            <Input id="mig-key" type="password" autocomplete="off" bind:value={form.api_key} aria-invalid={!!errors.api_key} />
            {#if errors.api_key}<Field.Error>{errors.api_key}</Field.Error>{:else}<Field.Description>{t('migration.key_hint')}</Field.Description>{/if}
          </Field.Field>
        </div>
      {/if}
      <div><Button type="submit" disabled={busy}>{#if busy && !batch}<Spinner />{/if}{t('migration.read')}</Button></div>
    </form>
  </Card.Content>
</Card.Root>

{#if batch}
  <Card.Root data-testid="migration-batch">
    <Card.Header>
      <Card.Title class="flex items-center gap-2">{t(`migration.source_name.${batch.source}` as any)} <StatusBadge status={STATUS[batch.status] ?? 'pending'} label={t(`migration.status.${batch.status}` as any)} /></Card.Title>
      <Card.Description>{t('migration.batch_hint')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-6">
      {#if batch.status === 'fetching' || batch.status === 'applying'}
        <p class="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />{t(`migration.status.${batch.status}` as any)}</p>
      {/if}
      {#if batch.error}<Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{batch.error}</Alert.Title></Alert.Root>{/if}
      {#each batch.imports as imp (imp.id)}
        <div class="flex flex-col gap-3">
          <ImportReport report={imp} title={t(`import.entity.${imp.entity}` as any)} />
        </div>
      {/each}
      {#if errorCount}<p class="text-destructive text-sm">{t('migration.fix_errors')}</p>{/if}
    </Card.Content>
    {#if batch.status === 'validated'}
      <Card.Footer><Button disabled={busy || errorCount > 0 || changes === 0} onclick={apply} data-testid="migration-apply">{#if busy}<Spinner />{/if}{t('migration.apply')}</Button></Card.Footer>
    {/if}
  </Card.Root>
{/if}

{#if recent.length}
  <Card.Root>
    <Card.Header><Card.Title>{t('migration.recent')}</Card.Title></Card.Header>
    <Card.Content>
      <ul class="flex flex-col divide-y text-sm">
        {#each recent as b (b.id)}
          <li class="flex flex-wrap items-center gap-2 py-2">
            <span class="font-medium">{t(`migration.source_name.${b.source}` as any)}</span>
            <StatusBadge status={STATUS[b.status] ?? 'pending'} label={t(`migration.status.${b.status}` as any)} />
            <span class="text-muted-foreground">{dt(b.created_at)}</span>
            <Button size="sm" variant="ghost" class="ml-auto" onclick={() => follow(b.id).catch(notifyError)}>{t('migration.show')}</Button>
          </li>
        {/each}
      </ul>
    </Card.Content>
  </Card.Root>
{/if}
