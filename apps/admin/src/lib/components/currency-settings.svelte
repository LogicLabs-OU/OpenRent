<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors, d } from '#lib';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * How the storefront shows prices (FR-I18N-7): with or without tax (also per language), and in other
   * currencies at rates typed in or kept up to date by a rates plugin. Orders are charged in the shop's own.
   */
  let { settings, base, onsaved }: { settings: any; base: string; onsaved?: () => void } = $props();
  const COMMON = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'JPY', 'AUD', 'CAD', 'NZD'];
  const dc0 = () => settings.display_currencies ?? { currencies: [], rates: {}, source: 'manual', updated_at: null };
  // svelte-ignore state_referenced_locally
  let incl = $state<boolean>(settings.display_prices_including_tax ?? true);
  // svelte-ignore state_referenced_locally
  let perLocale = $state<Record<string, string>>({ ...(settings.tax_display ?? {}) });
  let currencies = $state<string[]>([...dc0().currencies]);
  let rates = $state<Record<string, string>>(Object.fromEntries(Object.entries(dc0().rates).map(([c, r]) => [c, String(r)])));
  let source = $state<string>(dc0().source);
  let updatedAt = $state<string | null>(dc0().updated_at);
  let providers = $state<{ id: string; name: string }[]>([]);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let refreshing = $state(false);

  shopLocales.load().catch(notifyError);
  api.get('/plugins').then((r) => (providers = r.data.filter((p: any) => p.state === 'loaded' && p.provides.some((x: string) => x.startsWith('rates:')))), notifyError);
  const choices = $derived(COMMON.filter((c) => c !== base));

  function toggle(c: string, on: boolean) {
    currencies = on ? [...currencies, c] : currencies.filter((x) => x !== c);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const own = Object.fromEntries(Object.entries(rates).filter(([c, v]) => currencies.includes(c) && v.trim()).map(([c, v]) => [c, Number(v.replace(',', '.'))]));
      const r = await api.patch('/tenant/settings', {
        display_prices_including_tax: incl,
        tax_display: Object.fromEntries(Object.entries(perLocale).filter(([, v]) => v)),
        display_currencies: { currencies, source, ...(source === 'manual' ? { rates: own } : {}) },
      });
      updatedAt = r.display_currencies.updated_at;
      toast.success(t('common.saved'));
      onsaved?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    refreshing = true;
    try {
      const r = await api.post('/tenant/settings/actions/refresh_rates');
      rates = Object.fromEntries(Object.entries(r.display_currencies.rates).map(([c, v]) => [c, String(v)]));
      updatedAt = r.display_currencies.updated_at;
      toast.success(t('currencies.rates_updated'));
    } catch (err) {
      notifyError(err);
    } finally {
      refreshing = false;
    }
  }
</script>

<Card.Root data-testid="currency-settings">
  <Card.Header>
    <Card.Title>{t('currencies.title')}</Card.Title>
    <Card.Description>{t('currencies.hint', { base })}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form id="currency-form" class="flex flex-col gap-6" onsubmit={save}>
      <Field.Field orientation="horizontal">
        <Field.Label for="cur-incl" class="flex-1 font-normal">{t('currencies.incl_tax')}</Field.Label>
        <Switch id="cur-incl" bind:checked={incl} />
      </Field.Field>
      {#if shopLocales.list.length > 1}
        <Field.Set>
          <Field.Legend variant="label">{t('currencies.per_language')}</Field.Legend>
          <div class="grid gap-4 sm:grid-cols-2">
            {#each shopLocales.list as l (l)}
              <Field.Field data-invalid={!!errors[`tax_display.${l}`] || undefined}>
                <Field.Label for={`cur-tax-${l}`}>{LOCALE_NAMES[l as Locale] ?? l}</Field.Label>
                <NativeSelect id={`cur-tax-${l}`} class="w-full" bind:value={perLocale[l]}>
                  <NativeSelectOption value="">{t('currencies.tax_same')}</NativeSelectOption>
                  <NativeSelectOption value="incl">{t('currencies.tax_incl')}</NativeSelectOption>
                  <NativeSelectOption value="excl">{t('currencies.tax_excl')}</NativeSelectOption>
                </NativeSelect>
              </Field.Field>
            {/each}
          </div>
        </Field.Set>
      {/if}
      <Field.Set data-invalid={!!errors['display_currencies.currencies'] || undefined}>
        <Field.Legend variant="label">{t('currencies.also_show')}</Field.Legend>
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          {#each choices as c (c)}
            <Field.Field orientation="horizontal" class="w-auto">
              <Checkbox id={`cur-${c}`} checked={currencies.includes(c)} onCheckedChange={(v) => toggle(c, v === true)} />
              <Field.Label for={`cur-${c}`} class="font-normal">{c}</Field.Label>
            </Field.Field>
          {/each}
        </div>
        {#if errors['display_currencies.currencies']}<Field.Error>{errors['display_currencies.currencies']}</Field.Error>{/if}
      </Field.Set>
      {#if currencies.length}
        <Field.Field>
          <Field.Label for="cur-source">{t('currencies.rates_from')}</Field.Label>
          <NativeSelect id="cur-source" class="w-full sm:w-72" bind:value={source}>
            <NativeSelectOption value="manual">{t('currencies.rates_manual')}</NativeSelectOption>
            {#each providers as p (p.id)}<NativeSelectOption value={p.id}>{p.name}</NativeSelectOption>{/each}
          </NativeSelect>
          {#if source !== 'manual'}<Field.Description>{updatedAt ? t('currencies.rates_date', { date: d(`${updatedAt}T12:00:00Z`) }) : t('currencies.rates_daily')}</Field.Description>{/if}
        </Field.Field>
        <div class="grid gap-4 sm:grid-cols-3">
          {#each currencies as c (c)}
            <Field.Field data-invalid={!!errors[`display_currencies.rates.${c}`] || undefined}>
              <Field.Label for={`cur-rate-${c}`}>{t('currencies.rate', { base, code: c })}</Field.Label>
              <Input id={`cur-rate-${c}`} inputmode="decimal" readonly={source !== 'manual'} bind:value={rates[c]} aria-invalid={!!errors[`display_currencies.rates.${c}`]} />
              {#if errors[`display_currencies.rates.${c}`]}<Field.Error>{errors[`display_currencies.rates.${c}`]}</Field.Error>{/if}
            </Field.Field>
          {/each}
        </div>
      {/if}
    </form>
  </Card.Content>
  <Card.Footer class="gap-2">
    <Button type="submit" form="currency-form" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
    {#if source !== 'manual' && currencies.length}<Button variant="outline" disabled={refreshing} onclick={refresh}>{#if refreshing}<Spinner />{:else}<RefreshCwIcon />{/if}{t('currencies.update_now')}</Button>{/if}
  </Card.Footer>
</Card.Root>
