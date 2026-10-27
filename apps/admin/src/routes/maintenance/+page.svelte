<script lang="ts">
  import { onMount } from 'svelte';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Textarea } from '@openrent/ui/textarea';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader, StatusBadge, Money } from '@openrent/ui/openrent';
  import WrenchIcon from '@lucide/svelte/icons/wrench';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
  import GaugeIcon from '@lucide/svelte/icons/gauge';
  import { api, qs, t, toast, notifyError, fieldErrors, rel, dt, confirmAction, session, toLocalInput, fromLocalInput, minorFromInput, majorFromMinor } from '#lib';
  import { to } from '#lib/nav.ts';
  import PhotoStrip from '#lib/components/photo-strip.svelte';

  /**
   * Repairs (FR-MNT-2): tickets for one or more units with priority, assignee, due date, parts and
   * cost. Resolving puts the units back into service; cancelling does too, without a repair.
   */
  const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
  const PRIORITY_TONE: Record<string, string> = { urgent: 'overdue', high: 'pending', normal: 'draft', low: 'muted' };
  let filter = $state<'active' | 'done' | 'cancelled'>('active');
  let mine = $state(false);
  let priority = $state('');
  let overdue = $state(false);
  let rows = $state<any[] | null>(null);
  let open = $state<any>(null);
  let members = $state<{ id: string; name: string }[]>([]);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const canEdit = $derived(session.can('inventory:write'));

  type PartRow = { name: string; quantity: string; unit_cost: string };
  let edit = $state<{ title: string; notes: string; priority: string; assignee_id: string; due_at: string; cost: string; parts: PartRow[] } | null>(null);
  let resolution = $state('');

  type NewForm = { codes: { id: string; barcode: string; name: string }[]; code: string; title: string; severity: 'soft_down' | 'hard_down'; priority: string; assignee_id: string; due_at: string; notes: string };
  let creating = $state<NewForm | null>(null);

  async function load() {
    try {
      const q = { status: filter, location_id: session.locationId || undefined, assignee_id: mine ? 'me' : undefined, priority: priority || undefined, overdue: overdue || undefined };
      rows = (await api.get(`/maintenance_tickets?${qs(q)}`)).data;
      // The open ticket is refreshed; what staff are typing in its form stays (actions call show() themselves).
      if (open) open = rows!.find((r) => r.id === open.id) ?? (await api.get(`/maintenance_tickets/${open.id}`));
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void [filter, mine, priority, overdue, session.locationId];
    load();
  });
  onMount(() => {
    const me = session.me ? [{ id: session.me.user.id, name: session.me.user.name || session.me.user.email }] : [];
    members = me;
    if (session.can('users:read')) api.get('/users').then((r) => (members = r.data.map((u: any) => ({ id: u.id, name: u.name || u.email }))), () => undefined);
    // A notice links here with the ticket to open.
    const id = new URLSearchParams(location.search).get('ticket');
    if (id) api.get(`/maintenance_tickets/${id}`).then(show, notifyError);
  });

  function show(tk: any) {
    open = tk;
    errors = {};
    resolution = '';
    edit = {
      title: tk.title, notes: tk.notes, priority: tk.priority, assignee_id: tk.assignee?.id ?? '', due_at: tk.due_at ? toLocalInput(tk.due_at) : '',
      cost: majorFromMinor(tk.cost.amount), parts: tk.parts.map((p: any) => ({ name: p.name, quantity: String(p.quantity), unit_cost: majorFromMinor(p.unit_cost) })),
    };
  }
  const isOpen = (tk: any) => tk.status === 'open' || tk.status === 'in_progress';
  const parts = (rows: PartRow[]) => rows.map((p) => ({ name: p.name, quantity: Number(p.quantity), unit_cost: minorFromInput(p.unit_cost || 0) }));

  async function run(fn: () => Promise<any>, done?: string) {
    busy = true;
    errors = {};
    try {
      const r = await fn();
      if (done) toast.success(done);
      await load();
      return r;
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      busy = false;
    }
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!edit) return;
    const f = edit;
    run(
      async () =>
        show(
          await api.patch(`/maintenance_tickets/${open.id}`, {
            title: f.title, notes: f.notes, priority: f.priority, assignee_id: f.assignee_id || null, due_at: f.due_at ? fromLocalInput(f.due_at) : null,
            cost: minorFromInput(f.cost || 0), parts: parts(f.parts),
          }),
        ),
      t('common.saved'),
    );
  }

  async function resolve(outcome: 'available' | 'retired') {
    if (outcome === 'retired' && !(await confirmAction({ title: t('maintenance.retire_title'), description: t('maintenance.retire_description'), confirmLabel: t('maintenance.retire'), destructive: true }))) return;
    const code = open.units.map((u: any) => u.barcode).join(', ');
    const r = await run(
      () => api.post(`/maintenance_tickets/${open.id}/actions/resolve`, { outcome, resolution: resolution || undefined }),
      outcome === 'available' ? t('maintenance.back_in_service', { code }) : t('maintenance.retired', { code }),
    );
    if (r) open = null;
  }

  async function cancel() {
    if (!(await confirmAction({ title: t('maintenance.cancel_title'), description: t('maintenance.cancel_description'), confirmLabel: t('maintenance.cancel') }))) return;
    const r = await run(() => api.post(`/maintenance_tickets/${open.id}/actions/cancel`, { reason: resolution || undefined }), t('maintenance.cancelled'));
    if (r) open = null;
  }

  function startNew() {
    errors = {};
    creating = { codes: [], code: '', title: '', severity: 'soft_down', priority: 'normal', assignee_id: '', due_at: '', notes: '' };
  }

  /** Adds a unit to the new ticket by its barcode. */
  async function addCode(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !creating) return;
    e.preventDefault();
    const c = creating.code.trim();
    if (!c) return;
    try {
      const r = await api.post('/scans', { code: c, mode: 'lookup' });
      if (r.entity_type !== 'stock_item') throw new Error(t('scan.not_found', { code: c }));
      if (!creating.codes.some((x) => x.id === r.entity.id)) creating.codes = [...creating.codes, { id: r.entity.id, barcode: r.entity.barcode, name: r.entity.product_name }];
      creating.code = '';
    } catch (err) {
      notifyError(err);
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!creating) return;
    const f = creating;
    const tk = await run(
      () =>
        api.post('/maintenance_tickets', {
          stock_item_ids: f.codes.map((x) => x.id), title: f.title || undefined, severity: f.severity, priority: f.priority, assignee_id: f.assignee_id || null,
          due_at: f.due_at ? fromLocalInput(f.due_at) : null, notes: f.notes || undefined,
        }),
      t('maintenance.created'),
    );
    if (tk) {
      creating = null;
      show(tk);
    }
  }
  const unitErr = (i: number) => errors[`stock_item_ids[${i}]`];
</script>

<svelte:head><title>{t('nav.maintenance')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.maintenance')} description={t('maintenance.description')}>
  {#snippet actions()}
    <Button variant="outline" href={to('/maintenance/service')}><GaugeIcon />{t('service.title')}</Button>
    <Button variant="outline" href={to('/maintenance/checklists')}><ClipboardCheckIcon />{t('checklists.title')}</Button>
    {#if canEdit}<Button onclick={startNew}><PlusIcon />{t('maintenance.new')}</Button>{/if}
  {/snippet}
</PageHeader>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <ToggleGroup.Root type="single" variant="outline" value={filter} onValueChange={(v) => v && (filter = v as typeof filter)} aria-label={t('email.log.filter')}>
    <ToggleGroup.Item value="active">{t('maintenance.filter.active')}</ToggleGroup.Item>
    <ToggleGroup.Item value="done">{t('maintenance.filter.done')}</ToggleGroup.Item>
    <ToggleGroup.Item value="cancelled">{t('maintenance.filter.cancelled')}</ToggleGroup.Item>
  </ToggleGroup.Root>
  <NativeSelect size="sm" bind:value={priority} aria-label={t('maintenance.priority')}>
    <NativeSelectOption value="">{t('maintenance.all_priorities')}</NativeSelectOption>
    {#each PRIORITIES as p (p)}<NativeSelectOption value={p}>{t(`maintenance.priority.${p}`)}</NativeSelectOption>{/each}
  </NativeSelect>
  <Field.Field orientation="horizontal" class="w-auto">
    <Switch id="mt-mine" bind:checked={mine} />
    <Field.Label for="mt-mine" class="font-normal">{t('maintenance.mine')}</Field.Label>
  </Field.Field>
  <Field.Field orientation="horizontal" class="w-auto">
    <Switch id="mt-overdue" bind:checked={overdue} />
    <Field.Label for="mt-overdue" class="font-normal">{t('maintenance.overdue_only')}</Field.Label>
  </Field.Field>
</div>

{#if !rows}
  <Skeleton class="h-64 rounded-xl" />
{:else if !rows.length}
  <Empty.Root class="border">
    <Empty.Header><Empty.Media variant="icon"><WrenchIcon /></Empty.Media><Empty.Title>{t('maintenance.empty')}</Empty.Title><Empty.Description>{t('maintenance.empty_hint')}</Empty.Description></Empty.Header>
  </Empty.Root>
{:else}
  <div class="rounded-lg border" data-testid="maintenance-table">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{t('maintenance.col.unit')}</Table.Head><Table.Head>{t('maintenance.col.issue')}</Table.Head><Table.Head>{t('maintenance.priority')}</Table.Head>
          <Table.Head>{t('maintenance.assignee')}</Table.Head><Table.Head>{t('maintenance.due')}</Table.Head><Table.Head>{t('orders.col.status')}</Table.Head><Table.Head>{t('maintenance.col.opened')}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as tk (tk.id)}
          <Table.Row class="cursor-pointer" onclick={() => show(tk)}>
            <Table.Cell>
              <div class="font-medium">{tk.stock_item.product_name}</div>
              <div class="text-muted-foreground font-mono text-xs">{tk.units.map((u: any) => u.barcode).join(', ')}</div>
            </Table.Cell>
            <Table.Cell class="max-w-72 truncate whitespace-normal">{tk.title}{#if tk.photos.length} <Badge variant="secondary">{t('maintenance.photos', { count: tk.photos.length })}</Badge>{/if}</Table.Cell>
            <Table.Cell><StatusBadge status={PRIORITY_TONE[tk.priority]} label={t(`maintenance.priority.${tk.priority as 'normal'}`)} /></Table.Cell>
            <Table.Cell>{tk.assignee?.name ?? ''}</Table.Cell>
            <Table.Cell class={tk.overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}>{tk.due_at ? dt(tk.due_at) : ''}{#if tk.overdue} · {t('maintenance.overdue')}{/if}</Table.Cell>
            <Table.Cell><div class="flex flex-wrap gap-1"><StatusBadge status={tk.severity} label={t(`status.${tk.severity}` as any)} /><StatusBadge status={tk.status === 'in_progress' ? 'pending' : tk.status === 'done' ? 'closed' : tk.status === 'cancelled' ? 'cancelled' : 'open'} label={t(`maintenance.status.${tk.status}` as any)} /></div></Table.Cell>
            <Table.Cell class="text-muted-foreground text-xs" title={dt(tk.created_at)}>{rel(tk.created_at)}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}

<!-- One ticket. -->
<Sheet.Root open={!!open} onOpenChange={(o) => !o && (open = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
    {#if open && edit}
      <Sheet.Header>
        <Sheet.Title>{open.title}</Sheet.Title>
        <Sheet.Description class="font-mono">{open.units.map((u: any) => u.barcode).join(', ')}{#if open.order} · <a class="hover:underline" href={to(`/orders/${open.order.id}`)}>{t('order.title', { number: open.order.number })}</a>{/if}</Sheet.Description>
      </Sheet.Header>
      <div class="flex flex-col gap-6 px-4 pb-6">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge status={open.severity} label={t(`status.${open.severity}` as any)} />
          {#each open.units as u (u.id)}<StatusBadge status={u.status} label={`${u.barcode}: ${t(`status.${u.status}` as any)}`} />{/each}
          {#if open.status === 'open' && canEdit}<Button size="sm" variant="outline" disabled={busy} onclick={() => run(async () => show(await api.post(`/maintenance_tickets/${open.id}/actions/start`, {})), t('maintenance.started'))}>{t('maintenance.start')}</Button>{/if}
          {#if open.status === 'in_progress'}<Badge variant="secondary">{t('maintenance.status.in_progress')}</Badge>{/if}
        </div>
        <form class="flex flex-col gap-4" onsubmit={save} novalidate>
          <Field.Group>
            <Field.Field data-invalid={!!errors.title || undefined}>
              <Field.Label for="mt-title">{t('maintenance.title')}</Field.Label>
              <Input id="mt-title" bind:value={edit.title} readonly={!isOpen(open)} aria-invalid={!!errors.title} />
              {#if errors.title}<Field.Error>{errors.title}</Field.Error>{/if}
            </Field.Field>
            <div class="grid gap-4 sm:grid-cols-3">
              <Field.Field>
                <Field.Label for="mt-priority">{t('maintenance.priority')}</Field.Label>
                <NativeSelect id="mt-priority" class="w-full" bind:value={edit.priority} disabled={!isOpen(open)}>{#each PRIORITIES as p (p)}<NativeSelectOption value={p}>{t(`maintenance.priority.${p}`)}</NativeSelectOption>{/each}</NativeSelect>
              </Field.Field>
              <Field.Field data-invalid={!!errors.assignee_id || undefined}>
                <Field.Label for="mt-assignee">{t('maintenance.assignee')}</Field.Label>
                <NativeSelect id="mt-assignee" class="w-full" bind:value={edit.assignee_id} disabled={!isOpen(open)} aria-invalid={!!errors.assignee_id}>
                  <NativeSelectOption value="">{t('maintenance.nobody')}</NativeSelectOption>
                  {#each members as m (m.id)}<NativeSelectOption value={m.id}>{m.name}</NativeSelectOption>{/each}
                  {#if open.assignee && !members.some((m) => m.id === open.assignee.id)}<NativeSelectOption value={open.assignee.id}>{open.assignee.name}</NativeSelectOption>{/if}
                </NativeSelect>
                {#if errors.assignee_id}<Field.Error>{errors.assignee_id}</Field.Error>{/if}
              </Field.Field>
              <Field.Field data-invalid={!!errors.due_at || undefined}>
                <Field.Label for="mt-due">{t('maintenance.due')}</Field.Label>
                <Input id="mt-due" type="datetime-local" bind:value={edit.due_at} readonly={!isOpen(open)} aria-invalid={!!errors.due_at} />
                {#if errors.due_at}<Field.Error>{errors.due_at}</Field.Error>{/if}
              </Field.Field>
            </div>
            <Field.Field>
              <Field.Label for="mt-notes">{t('order.notes')}</Field.Label>
              <Textarea id="mt-notes" class="min-h-24" bind:value={edit.notes} readonly={!isOpen(open)} />
            </Field.Field>
            <Field.Set>
              <Field.Legend variant="label">{t('maintenance.parts')}</Field.Legend>
              {#each edit.parts as p, i (i)}
                <div class="grid grid-cols-[1fr_4.5rem_6rem_auto] items-start gap-2" data-testid="ticket-part">
                  <Field.Field data-invalid={!!errors[`parts[${i}].name`] || undefined}>
                    <Field.Label for={`mt-part-${i}`} class="sr-only">{t('maintenance.part_name')}</Field.Label>
                    <Input id={`mt-part-${i}`} placeholder={t('maintenance.part_name')} bind:value={p.name} readonly={!isOpen(open)} aria-invalid={!!errors[`parts[${i}].name`]} />
                    {#if errors[`parts[${i}].name`]}<Field.Error>{errors[`parts[${i}].name`]}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field data-invalid={!!errors[`parts[${i}].quantity`] || undefined}>
                    <Field.Label for={`mt-part-q-${i}`} class="sr-only">{t('field.quantity')}</Field.Label>
                    <Input id={`mt-part-q-${i}`} type="number" min="0" step="any" bind:value={p.quantity} readonly={!isOpen(open)} aria-invalid={!!errors[`parts[${i}].quantity`]} />
                    {#if errors[`parts[${i}].quantity`]}<Field.Error>{errors[`parts[${i}].quantity`]}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field data-invalid={!!errors[`parts[${i}].unit_cost`] || undefined}>
                    <Field.Label for={`mt-part-c-${i}`} class="sr-only">{t('maintenance.part_cost')}</Field.Label>
                    <Input id={`mt-part-c-${i}`} inputmode="decimal" bind:value={p.unit_cost} readonly={!isOpen(open)} aria-invalid={!!errors[`parts[${i}].unit_cost`]} />
                    {#if errors[`parts[${i}].unit_cost`]}<Field.Error>{errors[`parts[${i}].unit_cost`]}</Field.Error>{/if}
                  </Field.Field>
                  {#if isOpen(open)}<Button type="button" variant="ghost" size="icon-sm" aria-label={t('maintenance.remove_part', { name: p.name || '…' })} onclick={() => edit && (edit.parts = edit.parts.filter((_, j) => j !== i))}><XIcon /></Button>{/if}
                </div>
              {/each}
              {#if isOpen(open)}<div><Button type="button" size="sm" variant="outline" onclick={() => edit && (edit.parts = [...edit.parts, { name: '', quantity: '1', unit_cost: '0.00' }])}><PlusIcon />{t('maintenance.add_part')}</Button></div>{/if}
            </Field.Set>
            <Field.Field data-invalid={!!errors.cost || undefined}>
              <Field.Label for="mt-cost">{t('maintenance.labour')}</Field.Label>
              <Input id="mt-cost" class="w-32" inputmode="decimal" bind:value={edit.cost} readonly={!isOpen(open)} aria-invalid={!!errors.cost} />
              {#if errors.cost}<Field.Error>{errors.cost}</Field.Error>{/if}
            </Field.Field>
            <p class="text-sm">{t('maintenance.total_cost')}: <Money value={open.total_cost} /></p>
            {#if isOpen(open) && canEdit}<div><Button type="submit" variant="outline" disabled={busy}>{t('common.save')}</Button></div>{/if}
          </Field.Group>
        </form>
        <Field.Field>
          <Field.Label>{t('maintenance.photos_label')}</Field.Label>
          <PhotoStrip photos={open.photos} attachPath={`/maintenance_tickets/${open.id}/photos`} onadded={load} />
        </Field.Field>
        {#if isOpen(open) && canEdit}
          <Field.Group class="rounded-lg border p-4">
            <Field.Field>
              <Field.Label for="mt-close">{t('maintenance.close_note')}</Field.Label>
              <Textarea id="mt-close" placeholder={t('maintenance.close_note_hint')} bind:value={resolution} />
            </Field.Field>
            <div class="flex flex-wrap gap-2">
              <Button disabled={busy} onclick={() => resolve('available')}>{#if busy}<Spinner />{/if}{t('maintenance.close_available')}</Button>
              <Button variant="outline" disabled={busy} onclick={() => resolve('retired')}>{t('maintenance.retire')}</Button>
              <Button variant="ghost" disabled={busy} onclick={cancel}>{t('maintenance.cancel')}</Button>
            </div>
          </Field.Group>
        {:else if !isOpen(open)}
          {#if open.resolution}<p class="text-sm whitespace-pre-line">{open.resolution}</p>{/if}
          <p class="text-muted-foreground text-sm">{t('maintenance.closed_on', { when: dt(open.closed_at) })}</p>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<!-- A new ticket. -->
<Sheet.Root open={!!creating} onOpenChange={(o) => !o && (creating = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
    {#if creating}
      <form class="flex flex-col gap-4 p-4" onsubmit={create} novalidate>
        <Sheet.Header class="p-0">
          <Sheet.Title>{t('maintenance.new')}</Sheet.Title>
          <Sheet.Description>{t('maintenance.new_hint')}</Sheet.Description>
        </Sheet.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.stock_item_ids || undefined}>
            <Field.Label for="mtn-code">{t('maintenance.add_unit')}</Field.Label>
            <Input id="mtn-code" autocomplete="off" placeholder={t('transfers.add_unit_placeholder')} bind:value={creating.code} onkeydown={addCode} aria-invalid={!!errors.stock_item_ids} />
            {#if errors.stock_item_ids}<Field.Error>{errors.stock_item_ids}</Field.Error>{/if}
            {#each creating.codes as c, i (c.id)}
              <div class="flex items-center justify-between gap-2 text-sm" data-testid="ticket-unit">
                <span><span class="font-mono">{c.barcode}</span> · {c.name}{#if unitErr(i)}<span class="text-destructive block text-xs">{unitErr(i)}</span>{/if}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('transfers.remove_line', { name: c.barcode })} onclick={() => creating && (creating.codes = creating.codes.filter((x) => x.id !== c.id))}><XIcon /></Button>
              </div>
            {/each}
          </Field.Field>
          <Field.Field data-invalid={!!errors.title || undefined}>
            <Field.Label for="mtn-title">{t('maintenance.title')}</Field.Label>
            <Input id="mtn-title" bind:value={creating.title} placeholder={t('maintenance.title_hint')} />
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="mtn-severity">{t('maintenance.severity')}</Field.Label>
              <NativeSelect id="mtn-severity" class="w-full" bind:value={creating.severity}>{#each ['soft_down', 'hard_down'] as s (s)}<NativeSelectOption value={s}>{t(`status.${s}` as any)}</NativeSelectOption>{/each}</NativeSelect>
            </Field.Field>
            <Field.Field>
              <Field.Label for="mtn-priority">{t('maintenance.priority')}</Field.Label>
              <NativeSelect id="mtn-priority" class="w-full" bind:value={creating.priority}>{#each PRIORITIES as p (p)}<NativeSelectOption value={p}>{t(`maintenance.priority.${p}`)}</NativeSelectOption>{/each}</NativeSelect>
            </Field.Field>
            <Field.Field data-invalid={!!errors.assignee_id || undefined}>
              <Field.Label for="mtn-assignee">{t('maintenance.assignee')}</Field.Label>
              <NativeSelect id="mtn-assignee" class="w-full" bind:value={creating.assignee_id}>
                <NativeSelectOption value="">{t('maintenance.nobody')}</NativeSelectOption>
                {#each members as m (m.id)}<NativeSelectOption value={m.id}>{m.name}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.assignee_id}<Field.Error>{errors.assignee_id}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.due_at || undefined}>
              <Field.Label for="mtn-due">{t('maintenance.due')}</Field.Label>
              <Input id="mtn-due" type="datetime-local" bind:value={creating.due_at} />
              {#if errors.due_at}<Field.Error>{errors.due_at}</Field.Error>{/if}
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="mtn-notes">{t('order.notes')}</Field.Label>
            <Textarea id="mtn-notes" bind:value={creating.notes} />
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="p-0">
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('maintenance.create')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
