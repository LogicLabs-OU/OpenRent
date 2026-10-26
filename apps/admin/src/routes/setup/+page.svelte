<script lang="ts">
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import { api, session, t, fieldErrors } from '#lib';
  import { to } from '#lib/nav.ts';

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [zone];
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF', 'PLN', 'CZK', 'CAD', 'AUD'];
  let form = $state({
    owner: { name: '', email: '', password: '' },
    tenant: { name: '', currency: 'EUR', timezone: zone },
    location: { name: '' },
    tax: { name: 'VAT', rate: '20' },
    demo_data: true,
  });
  let errors = $state<Record<string, string>>({});
  let error = $state('');
  let busy = $state(false);
  let result = $state<any>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    errors = {};
    try {
      result = await api.post('/setup', {
        owner: form.owner,
        tenant: form.tenant,
        location: { name: form.location.name || t('setup.default_location') },
        tax: { name: form.tax.name, rate_bp: Math.round(Number(form.tax.rate) * 100) },
        demo_data: form.demo_data,
      });
      await session.load();
    } catch (err) {
      errors = fieldErrors(err);
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{t('setup.title')} · OpenRent</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
  <div class="w-full max-w-xl">
    {#if result}
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-xl"><CircleCheckIcon class="text-primary" />{t('setup.done_title')}</Card.Title>
          <Card.Description>{t('setup.done_description')}</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <Field.Field>
            <Field.Label>{t('setup.publishable_key')}</Field.Label>
            <Input readonly value={result.publishable_key} class="font-mono text-xs" />
            <Field.Description>{t('setup.publishable_key_hint')}</Field.Description>
          </Field.Field>
          <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('setup.next_payments')}</li>
            <li>{t('setup.next_products')}</li>
            <li>{t('setup.next_booking')}</li>
          </ol>
        </Card.Content>
        <Card.Footer><Button onclick={() => goto(to('/'))}>{t('setup.open_dashboard')}</Button></Card.Footer>
      </Card.Root>
    {:else}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-xl">{t('setup.title')}</Card.Title>
          <Card.Description>{t('setup.subtitle')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <form onsubmit={submit}>
            <Field.Group>
              {#if error}<Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{error}</Alert.Title></Alert.Root>{/if}
              <Field.Set>
                <Field.Legend>{t('setup.owner')}</Field.Legend>
                <Field.Group class="grid gap-4 sm:grid-cols-2">
                  <Field.Field><Field.Label for="on">{t('field.name')}</Field.Label><Input id="on" required bind:value={form.owner.name} /></Field.Field>
                  <Field.Field><Field.Label for="oe">{t('field.email')}</Field.Label><Input id="oe" type="email" required bind:value={form.owner.email} /></Field.Field>
                  <Field.Field class="sm:col-span-2" data-invalid={!!errors['owner.password'] || undefined}>
                    <Field.Label for="op">{t('field.password')}</Field.Label>
                    <Input id="op" type="password" minlength={8} required bind:value={form.owner.password} aria-invalid={!!errors['owner.password'] || undefined} />
                    {#if errors['owner.password']}<Field.Error>{errors['owner.password']}</Field.Error>{:else}<Field.Description>{t('setup.password_hint')}</Field.Description>{/if}
                  </Field.Field>
                </Field.Group>
              </Field.Set>
              <Field.Separator />
              <Field.Set>
                <Field.Legend>{t('setup.business')}</Field.Legend>
                <Field.Group class="grid gap-4 sm:grid-cols-2">
                  <Field.Field class="sm:col-span-2"><Field.Label for="tn">{t('setup.shop_name')}</Field.Label><Input id="tn" required bind:value={form.tenant.name} /></Field.Field>
                  <Field.Field>
                    <Field.Label for="tc">{t('field.currency')}</Field.Label>
                    <NativeSelect.Root id="tc" class="w-full" bind:value={form.tenant.currency}>{#each CURRENCIES as c}<NativeSelect.Option value={c}>{c}</NativeSelect.Option>{/each}</NativeSelect.Root>
                  </Field.Field>
                  <Field.Field>
                    <Field.Label for="tz">{t('field.timezone')}</Field.Label>
                    <NativeSelect.Root id="tz" class="w-full" bind:value={form.tenant.timezone}>{#each zones as z}<NativeSelect.Option value={z}>{z}</NativeSelect.Option>{/each}</NativeSelect.Root>
                  </Field.Field>
                  <Field.Field><Field.Label for="ln">{t('setup.first_location')}</Field.Label><Input id="ln" placeholder={t('setup.default_location')} bind:value={form.location.name} /></Field.Field>
                  <Field.Field><Field.Label for="tr">{t('setup.tax_rate')}</Field.Label><Input id="tr" inputmode="decimal" bind:value={form.tax.rate} /></Field.Field>
                </Field.Group>
              </Field.Set>
              <Field.Field orientation="horizontal">
                <Checkbox id="demo" bind:checked={form.demo_data} />
                <Field.Label for="demo" class="font-normal">{t('setup.demo_data')}</Field.Label>
              </Field.Field>
              <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('setup.submit')}</Button>
            </Field.Group>
          </form>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
</div>
