<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
  import { api, t, toast, notifyError, fieldErrors, session, getLocale, d } from '#lib';

  /** Price suggestions (FR-PR-9): busy and quiet weeks per product; staff accept or dismiss each. */
  let list = $state<any[] | null>(null);
  let cfg = $state({ enabled: true, busy: '85', quiet: '30', step: '10' });
  let cfgErrors = $state<Record<string, string>>({});
  let busy = $state(false);
  let accepting = $state<any>(null);
  let percent = $state('');
  let acceptErrors = $state<Record<string, string>>({});
  const canEdit = $derived(session.can('pricing:write'));
  const canSet = $derived(session.can('tenant:write'));

  const pct = (bp: number | null, sign = false) =>
    bp === null ? '–' : new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 1, ...(sign ? { signDisplay: 'always' as const } : {}) }).format(bp / 10000);

  async function load() {
    const [s, settings] = await Promise.all([api.get('/price_suggestions?status=open'), api.get('/tenant/settings')]);
    list = s.data;
    const c = settings.price_suggestions;
    cfg = { enabled: c.enabled, busy: String(c.busy_bp / 100), quiet: String(c.quiet_bp / 100), step: String(c.step_bp / 100) };
  }
  onMount(() => load().catch(notifyError));

  async function refresh() {
    busy = true;
    try {
      const r = await api.post('/price_suggestions/actions/refresh', {});
      toast.success(t('price_suggestion.refreshed', { count: r.count }));
      await load();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function saveSettings(e: SubmitEvent) {
    e.preventDefault();
    cfgErrors = {};
    const bp = (v: string) => Math.round(Number(v) * 100);
    try {
      await api.patch('/tenant/settings', { price_suggestions: { enabled: cfg.enabled, busy_bp: bp(cfg.busy), quiet_bp: bp(cfg.quiet), step_bp: bp(cfg.step) } });
      toast.success(t('common.saved'));
    } catch (err) {
      cfgErrors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^price_suggestions\./, ''), v]));
      if (!Object.keys(cfgErrors).length) notifyError(err);
    }
  }

  function startAccept(s: any) {
    accepting = s;
    percent = String(Math.abs(s.adjustment_bp) / 100);
    acceptErrors = {};
  }

  async function accept(e: SubmitEvent) {
    e.preventDefault();
    acceptErrors = {};
    const sign = accepting.adjustment_bp < 0 ? -1 : 1;
    try {
      await api.post(`/price_suggestions/${accepting.id}/actions/accept`, { adjustment_bp: sign * Math.round(Number(percent || 0) * 100) });
      toast.success(t('price_suggestion.accepted'));
      accepting = null;
      await load();
    } catch (err) {
      acceptErrors = fieldErrors(err);
      if (!Object.keys(acceptErrors).length) notifyError(err);
    }
  }

  async function dismiss(s: any) {
    try {
      await api.post(`/price_suggestions/${s.id}/actions/dismiss`, {});
      toast.success(t('price_suggestion.dismissed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<div class="flex flex-col gap-6" data-testid="price-suggestions">
  <Card.Root>
    <Card.Header>
      <Card.Title>{t('price_suggestion.title')}</Card.Title>
      <Card.Description>{t('price_suggestion.description')}</Card.Description>
      {#if canEdit}
        <Card.Action><Button variant="outline" disabled={busy} onclick={refresh}>{#if busy}<Spinner />{:else}<RefreshCwIcon />{/if}{t('price_suggestion.refresh')}</Button></Card.Action>
      {/if}
    </Card.Header>
    <Card.Content>
      {#if list === null}
        <Spinner />
      {:else if !list.length}
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><TrendingUpIcon /></Empty.Media>
            <Empty.Title>{t('price_suggestion.none')}</Empty.Title>
            <Empty.Description>{t('price_suggestion.none_hint')}</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{t('price_suggestion.product')}</Table.Head>
              <Table.Head>{t('price_suggestion.weeks')}</Table.Head>
              <Table.Head class="text-right">{t('price_suggestion.booked')}</Table.Head>
              <Table.Head class="text-right">{t('price_suggestion.last_year')}</Table.Head>
              <Table.Head class="text-right">{t('price_suggestion.change')}</Table.Head>
              <Table.Head class="w-48"><span class="sr-only">{t('price_suggestion.actions')}</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each list as s (s.id)}
              <Table.Row data-testid="price-suggestion">
                <Table.Cell class="font-medium">{s.product_name}</Table.Cell>
                <Table.Cell>{t('pricing.when_dates', { from: d(s.starts_on, 'UTC'), to: d(s.ends_on, 'UTC') })}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{pct(s.booked_bp)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{pct(s.last_year_bp)}</Table.Cell>
                <Table.Cell class={['text-right font-medium tabular-nums', s.adjustment_bp < 0 ? 'text-emerald-700 dark:text-emerald-400' : '']}>{pct(s.adjustment_bp, true)}</Table.Cell>
                <Table.Cell class="text-right">
                  {#if canEdit}
                    <Button size="sm" variant="ghost" onclick={() => startAccept(s)}>{t('price_suggestion.accept')}</Button>
                    <Button size="sm" variant="ghost" onclick={() => dismiss(s)}>{t('price_suggestion.dismiss')}</Button>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if canSet}
    <Card.Root>
      <Card.Header>
        <Card.Title>{t('price_suggestion.settings')}</Card.Title>
        <Card.Description>{t('price_suggestion.settings_hint')}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={saveSettings}>
          <Field.Field orientation="horizontal">
            <Switch id="ps-on" bind:checked={cfg.enabled} />
            <Field.Label for="ps-on">{t('price_suggestion.enabled')}</Field.Label>
          </Field.Field>
          <Field.Group class="grid gap-4 sm:grid-cols-3">
            {#each [['busy_bp', 'busy', t('price_suggestion.busy_from')], ['quiet_bp', 'quiet', t('price_suggestion.quiet_below')], ['step_bp', 'step', t('price_suggestion.step')]] as const as [key, field, label] (key)}
              <Field.Field data-invalid={!!cfgErrors[key] || undefined}>
                <Field.Label for={`ps-${field}`}>{label}</Field.Label>
                <Input id={`ps-${field}`} type="number" min="1" max="100" step="1" bind:value={cfg[field]} aria-invalid={!!cfgErrors[key]} />
                {#if cfgErrors[key]}<Field.Error>{cfgErrors[key]}</Field.Error>{/if}
              </Field.Field>
            {/each}
          </Field.Group>
          <div><Button type="submit">{t('common.save')}</Button></div>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

<Dialog.Root open={!!accepting} onOpenChange={(o) => { if (!o) accepting = null; }}>
  <Dialog.Content>
    {#if accepting}
      <form class="flex flex-col gap-4" onsubmit={accept}>
        <Dialog.Header>
          <Dialog.Title>{t(accepting.adjustment_bp > 0 ? 'price_suggestion.accept_busy_title' : 'price_suggestion.accept_quiet_title', { product: accepting.product_name })}</Dialog.Title>
          <Dialog.Description>{t('price_suggestion.accept_hint', { from: d(accepting.starts_on, 'UTC'), to: d(accepting.ends_on, 'UTC') })}</Dialog.Description>
        </Dialog.Header>
        <Field.Field data-invalid={!!acceptErrors.adjustment_bp || undefined}>
          <Field.Label for="ps-percent">{t(accepting.adjustment_bp > 0 ? 'price_suggestion.percent_up' : 'price_suggestion.percent_down')}</Field.Label>
          <Input id="ps-percent" type="number" min="1" max="90" step="0.5" bind:value={percent} aria-invalid={!!acceptErrors.adjustment_bp} />
          {#if acceptErrors.adjustment_bp}<Field.Error>{acceptErrors.adjustment_bp}</Field.Error>{/if}
        </Field.Field>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (accepting = null)}>{t('common.cancel')}</Button>
          <Button type="submit">{t('price_suggestion.make_rule')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
