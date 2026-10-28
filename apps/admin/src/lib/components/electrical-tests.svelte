<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import PlugZapIcon from '@lucide/svelte/icons/plug-zap';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { api, t, toast, notifyError, fieldErrors, session, d, download } from '#lib';

  /** Electrical safety tests (PAT, FR-MNT-5) on the unit page: whether it may go out, the tests, a new one. */
  let { stockItemId, onchange }: { stockItemId: string; onchange?: () => void } = $props();
  let status = $state<any>(null);
  let tests = $state<any[]>([]);
  let open = $state(false);
  let errors = $state<Record<string, string>>({});
  const today = () => new Date().toISOString().slice(0, 10);
  const blankForm = () => ({ tested_on: today(), result: 'pass', appliance_class: 'I', earth_ohm: '', insulation_mohm: '', leakage_ma: '', polarity_ok: true, visual_ok: true, tester: session.me?.user.name ?? '', instrument: '', notes: '' });
  let form = $state(blankForm());
  const canEdit = $derived(session.can('inventory:write'));

  async function load() {
    try {
      const r = await api.get(`/stock_items/${stockItemId}/electrical_tests`);
      status = r.status;
      tests = r.data;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  const num = (v: string) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      // The day tested at noon, so the shop's time zone cannot move it to another day.
      await api.post(`/stock_items/${stockItemId}/electrical_tests`, {
        tested_at: form.tested_on ? `${form.tested_on}T12:00:00Z` : null, result: form.result, appliance_class: form.appliance_class || null, tester: form.tester, instrument: form.instrument || null, notes: form.notes,
        readings: { earth_ohm: num(form.earth_ohm), insulation_mohm: num(form.insulation_mohm), leakage_ma: num(form.leakage_ma), polarity_ok: form.polarity_ok, visual_ok: form.visual_ok },
      });
      toast.success(t(form.result === 'pass' ? 'pat.recorded_pass' : 'pat.recorded_fail'));
      open = false;
      await load();
      onchange?.();
    } catch (err) {
      errors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^readings\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(err);
    }
  }
</script>

<Card.Root data-testid="electrical-tests">
  <Card.Header>
    <Card.Title class="flex items-center gap-2"><PlugZapIcon class="size-4" aria-hidden="true" />{t('pat.title')}</Card.Title>
    {#if canEdit}<Card.Action><Button size="sm" variant="outline" onclick={() => { form = blankForm(); errors = {}; open = true; }}>{t('pat.record')}</Button></Card.Action>{/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if status?.required}
      {#if status.expired}
        <Alert.Root variant="destructive" data-testid="pat-status">
          <PlugZapIcon />
          <Alert.Title>{t('pat.expired_title')}</Alert.Title>
          <Alert.Description>{status.last_test?.result === 'fail' ? t('pat.failed_hint') : status.valid_until ? t('pat.expired_since', { date: d(status.valid_until) }) : t('pat.never_tested')}</Alert.Description>
        </Alert.Root>
      {:else}
        <p class="text-sm" data-testid="pat-status">{t('pat.valid_until', { date: d(status.valid_until), name: status.interval.name })}</p>
      {/if}
    {:else if status}
      <p class="text-muted-foreground text-sm" data-testid="pat-status">{t('pat.not_required')}</p>
    {/if}
    {#if tests.length}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('pat.tested_on')}</Table.Head>
            <Table.Head>{t('pat.result')}</Table.Head>
            <Table.Head>{t('pat.tester')}</Table.Head>
            <Table.Head class="w-12"><span class="sr-only">{t('pat.certificate')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each tests as x (x.id)}
            <Table.Row data-testid="pat-test">
              <Table.Cell>{d(x.tested_at)}</Table.Cell>
              <Table.Cell><Badge variant={x.result === 'pass' ? 'secondary' : 'destructive'}>{t(x.result === 'pass' ? 'pat.pass' : 'pat.fail')}</Badge></Table.Cell>
              <Table.Cell>{x.tester}</Table.Cell>
              <Table.Cell class="text-right"><Button size="icon-sm" variant="ghost" aria-label={t('pat.certificate_of', { date: d(x.tested_at) })} title={t('pat.certificate')} onclick={() => download(`/electrical_tests/${x.id}/certificate`).catch(notifyError)}><FileTextIcon /></Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <form class="flex flex-col gap-4" onsubmit={save} novalidate>
      <Dialog.Header>
        <Dialog.Title>{t('pat.record')}</Dialog.Title>
        <Dialog.Description>{t('pat.record_hint')}</Dialog.Description>
      </Dialog.Header>
      <Field.Group class="grid gap-3 sm:grid-cols-2">
        <Field.Field data-invalid={!!errors.tested_at || undefined}>
          <Field.Label for="pat-date">{t('pat.tested_on')}</Field.Label>
          <Input id="pat-date" type="date" bind:value={form.tested_on} aria-invalid={!!errors.tested_at} />
          {#if errors.tested_at}<Field.Error>{errors.tested_at}</Field.Error>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!errors.result || undefined}>
          <Field.Label for="pat-result">{t('pat.result')}</Field.Label>
          <NativeSelect id="pat-result" class="w-full" bind:value={form.result}>
            <NativeSelectOption value="pass">{t('pat.pass')}</NativeSelectOption>
            <NativeSelectOption value="fail">{t('pat.fail')}</NativeSelectOption>
          </NativeSelect>
        </Field.Field>
        <Field.Field data-invalid={!!errors.appliance_class || undefined}>
          <Field.Label for="pat-class">{t('pat.class')}</Field.Label>
          <NativeSelect id="pat-class" class="w-full" bind:value={form.appliance_class}>
            <NativeSelectOption value="I">{t('pat.class_i')}</NativeSelectOption>
            <NativeSelectOption value="II">{t('pat.class_ii')}</NativeSelectOption>
            <NativeSelectOption value="III">{t('pat.class_iii')}</NativeSelectOption>
          </NativeSelect>
        </Field.Field>
        {#each [['earth_ohm', 'pat.earth'], ['insulation_mohm', 'pat.insulation'], ['leakage_ma', 'pat.leakage']] as [k, label] (k)}
          <Field.Field data-invalid={!!errors[k] || undefined}>
            <Field.Label for={`pat-${k}`}>{t(label as any)}</Field.Label>
            <Input id={`pat-${k}`} inputmode="decimal" bind:value={form[k as 'earth_ohm']} aria-invalid={!!errors[k]} />
            {#if errors[k]}<Field.Error>{errors[k]}</Field.Error>{/if}
          </Field.Field>
        {/each}
      </Field.Group>
      <Field.Field orientation="horizontal"><Checkbox id="pat-visual" bind:checked={form.visual_ok} /><Field.Label for="pat-visual" class="font-normal">{t('pat.visual_ok')}</Field.Label></Field.Field>
      <Field.Field orientation="horizontal"><Checkbox id="pat-polarity" bind:checked={form.polarity_ok} /><Field.Label for="pat-polarity" class="font-normal">{t('pat.polarity_ok')}</Field.Label></Field.Field>
      <Field.Group class="grid gap-3 sm:grid-cols-2">
        <Field.Field data-invalid={!!errors.tester || undefined}>
          <Field.Label for="pat-tester">{t('pat.tester')}</Field.Label>
          <Input id="pat-tester" bind:value={form.tester} aria-invalid={!!errors.tester} />
          {#if errors.tester}<Field.Error>{errors.tester}</Field.Error>{/if}
        </Field.Field>
        <Field.Field>
          <Field.Label for="pat-instrument">{t('pat.instrument')}</Field.Label>
          <Input id="pat-instrument" placeholder={t('pat.instrument_placeholder')} bind:value={form.instrument} />
        </Field.Field>
      </Field.Group>
      <Field.Field>
        <Field.Label for="pat-notes">{t('pat.notes')}</Field.Label>
        <Textarea id="pat-notes" rows={2} bind:value={form.notes} />
      </Field.Field>
      {#if form.result === 'fail'}<p class="text-destructive text-sm">{t('pat.fail_hint')}</p>{/if}
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
        <Button type="submit">{t('common.save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
