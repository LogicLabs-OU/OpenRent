<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { t } from './i18n/index.ts';

  /**
   * The account's billing details and delivery addresses (ADR 0012): each customer keeps their own, private
   * or for a company with its VAT number, and picks one at checkout. Orders keep a copy of the one chosen.
   */
  type Address = { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string };
  type Profile = { id: string; kind: 'private' | 'company'; name: string; company_name: string | null; tax_id: string | null; tax_id_check: { status: string } | null; address: Address; is_default: boolean };
  type Saved = { id: string; label: string | null; recipient: string | null; phone: string | null; address: Address; is_default: boolean };
  type Draft = { what: 'profile' | 'address'; id: string | null; kind: 'private' | 'company'; name: string; company_name: string; tax_id: string; label: string; recipient: string; phone: string; address: Required<Pick<Address, 'line1' | 'postal_code' | 'city' | 'country'>> };

  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const profiles = $derived((page.data.billing?.profiles ?? []) as Profile[]);
  const addresses = $derived((page.data.billing?.addresses ?? []) as Saved[]);
  let draft = $state<Draft | null>(null);
  let errors = $state<Record<string, string>>({});
  let failed = $state('');
  let busy = $state(false);

  const lines = (a: Address) => [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');
  const empty = (what: Draft['what']): Draft => ({ what, id: null, kind: 'private', name: page.data.account?.name ?? '', company_name: '', tax_id: '', label: '', recipient: '', phone: '', address: { line1: '', postal_code: '', city: '', country: '' } });
  function edit(what: Draft['what'], x: Profile | Saved) {
    errors = {};
    failed = '';
    const a = x.address ?? {};
    const address = { line1: a.line1 ?? '', postal_code: a.postal_code ?? '', city: a.city ?? '', country: a.country ?? '' };
    draft = 'kind' in x
      ? { ...empty('profile'), id: x.id, kind: x.kind, name: x.name, company_name: x.company_name ?? '', tax_id: x.tax_id ?? '', address }
      : { ...empty('address'), id: x.id, label: x.label ?? '', recipient: x.recipient ?? '', phone: x.phone ?? '', address };
  }

  async function call(method: 'POST' | 'DELETE', body: unknown) {
    const res = await fetch('/_or/account/billing', { method, headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message ?? res.statusText), { status: res.status, fields: json.errors ?? [] });
    return json;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!draft) return;
    busy = true;
    errors = {};
    failed = '';
    const address = Object.fromEntries(Object.entries(draft.address).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const data = draft.what === 'profile'
      ? { kind: draft.kind, name: draft.name, company_name: draft.kind === 'company' ? draft.company_name : null, tax_id: draft.kind === 'company' ? draft.tax_id : null, address }
      : { label: draft.label || null, recipient: draft.recipient || null, phone: draft.phone || null, address };
    try {
      await call('POST', { what: draft.what, id: draft.id, data });
      draft = null;
      await invalidateAll();
    } catch (err: any) {
      if (err.status === 422 && err.fields.length) errors = Object.fromEntries(err.fields.map((f: { field: string; message: string }) => [f.field, f.message]));
      else failed = err.message;
    } finally {
      busy = false;
    }
  }

  async function act(what: Draft['what'], id: string, kind: 'default' | 'delete') {
    failed = '';
    try {
      if (kind === 'delete') await call('DELETE', { what, id });
      else await call('POST', { what, id, data: { is_default: true } });
      await invalidateAll();
    } catch (err: any) {
      failed = err.message;
    }
  }

  const uid = (k: string) => `or-bill-${k}`;
</script>

<Card.Root data-testid="account-billing">
  <Card.Header>
    <Card.Title>{tr('billing.title')}</Card.Title>
    <Card.Description>{tr('billing.hint')}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <section class="flex flex-col gap-3" aria-labelledby="or-bill-profiles">
      <div class="flex items-center justify-between gap-2">
        <h3 id="or-bill-profiles" class="font-medium">{tr('billing.profiles')}</h3>
        <Button size="sm" variant="outline" onclick={() => ((draft = empty('profile')), (errors = {}))}>{tr('billing.add_profile')}</Button>
      </div>
      {#each profiles as p (p.id)}
        <div class="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm" data-testid="billing-profile">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium">{p.kind === 'company' ? p.company_name : p.name}{#if p.is_default} <Badge variant="secondary">{tr('billing.default')}</Badge>{/if}</span>
            {#if p.kind === 'company'}<span class="opacity-80">{p.name}</span>{/if}
            {#if p.tax_id}<span class="opacity-80">{tr('billing.tax_id_value', { id: p.tax_id })} · {p.tax_id_check?.status === 'valid' ? tr('billing.tax_id_valid') : tr('billing.tax_id_unchecked')}</span>{/if}
            {#if lines(p.address)}<span class="opacity-80">{lines(p.address)}</span>{/if}
          </div>
          <div class="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onclick={() => edit('profile', p)}>{tr('billing.edit')}</Button>
            {#if !p.is_default}<Button size="sm" variant="ghost" onclick={() => act('profile', p.id, 'default')}>{tr('billing.make_default')}</Button>{/if}
            <Button size="sm" variant="ghost" onclick={() => act('profile', p.id, 'delete')}>{tr('billing.delete')}</Button>
          </div>
        </div>
      {:else}
        <p class="text-sm opacity-70">{tr('billing.no_profiles')}</p>
      {/each}
    </section>

    <section class="flex flex-col gap-3" aria-labelledby="or-bill-addresses">
      <div class="flex items-center justify-between gap-2">
        <h3 id="or-bill-addresses" class="font-medium">{tr('billing.addresses')}</h3>
        <Button size="sm" variant="outline" onclick={() => ((draft = empty('address')), (errors = {}))}>{tr('billing.add_address')}</Button>
      </div>
      {#each addresses as a (a.id)}
        <div class="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm" data-testid="saved-address">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium">{a.label || a.recipient || lines(a.address)}{#if a.is_default} <Badge variant="secondary">{tr('billing.default')}</Badge>{/if}</span>
            <span class="opacity-80">{lines(a.address)}</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onclick={() => edit('address', a)}>{tr('billing.edit')}</Button>
            {#if !a.is_default}<Button size="sm" variant="ghost" onclick={() => act('address', a.id, 'default')}>{tr('billing.make_default')}</Button>{/if}
            <Button size="sm" variant="ghost" onclick={() => act('address', a.id, 'delete')}>{tr('billing.delete')}</Button>
          </div>
        </div>
      {:else}
        <p class="text-sm opacity-70">{tr('billing.no_addresses')}</p>
      {/each}
    </section>

    {#if failed}<p class="text-sm text-destructive" role="alert">{failed}</p>{/if}

    {#if draft}
      <form class="flex flex-col gap-4 rounded-lg border p-4" onsubmit={save} data-testid="billing-form">
        <h3 class="font-medium">{draft.what === 'profile' ? (draft.id ? tr('billing.edit_profile') : tr('billing.add_profile')) : draft.id ? tr('billing.edit_address') : tr('billing.add_address')}</h3>
        <Field.Group>
          {#if draft.what === 'profile'}
            <Field.Field>
              <Field.Label for={uid('kind')}>{tr('billing.kind')}</Field.Label>
              <NativeSelect id={uid('kind')} bind:value={draft.kind}>
                <NativeSelectOption value="private">{tr('billing.kind_private')}</NativeSelectOption>
                <NativeSelectOption value="company">{tr('billing.kind_company')}</NativeSelectOption>
              </NativeSelect>
            </Field.Field>
            <Field.Field data-invalid={!!errors.name || undefined}>
              <Field.Label for={uid('name')}>{draft.kind === 'company' ? tr('billing.contact_name') : tr('billing.name')}</Field.Label>
              <Input id={uid('name')} autocomplete="name" maxlength={200} bind:value={draft.name} aria-invalid={!!errors.name} />
              {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
            </Field.Field>
            {#if draft.kind === 'company'}
              <Field.Field data-invalid={!!errors.company_name || undefined}>
                <Field.Label for={uid('company')}>{tr('billing.company')}</Field.Label>
                <Input id={uid('company')} autocomplete="organization" maxlength={200} bind:value={draft.company_name} aria-invalid={!!errors.company_name} />
                {#if errors.company_name}<Field.Error>{errors.company_name}</Field.Error>{/if}
              </Field.Field>
              <Field.Field data-invalid={!!errors.tax_id || undefined}>
                <Field.Label for={uid('tax')}>{tr('billing.tax_id')}</Field.Label>
                <Input id={uid('tax')} maxlength={40} bind:value={draft.tax_id} aria-invalid={!!errors.tax_id} />
                {#if errors.tax_id}<Field.Error>{errors.tax_id}</Field.Error>{:else}<Field.Description>{tr('billing.tax_id_hint')}</Field.Description>{/if}
              </Field.Field>
            {/if}
          {:else}
            <Field.Field>
              <Field.Label for={uid('label')}>{tr('billing.label')}</Field.Label>
              <Input id={uid('label')} maxlength={80} placeholder={tr('billing.label_placeholder')} bind:value={draft.label} />
            </Field.Field>
            <Field.Field>
              <Field.Label for={uid('recipient')}>{tr('billing.recipient')}</Field.Label>
              <Input id={uid('recipient')} autocomplete="name" maxlength={200} bind:value={draft.recipient} />
            </Field.Field>
            <Field.Field>
              <Field.Label for={uid('phone')}>{tr('billing.phone')}</Field.Label>
              <Input id={uid('phone')} type="tel" autocomplete="tel" maxlength={40} bind:value={draft.phone} />
            </Field.Field>
          {/if}
          <Field.Field data-invalid={!!errors['address.line1'] || undefined}>
            <Field.Label for={uid('line1')}>{tr('billing.street')}</Field.Label>
            <Input id={uid('line1')} autocomplete="address-line1" maxlength={200} bind:value={draft.address.line1} aria-invalid={!!errors['address.line1']} />
            {#if errors['address.line1']}<Field.Error>{errors['address.line1']}</Field.Error>{/if}
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-[8rem_1fr_6rem]">
            <Field.Field>
              <Field.Label for={uid('postcode')}>{tr('billing.postcode')}</Field.Label>
              <Input id={uid('postcode')} autocomplete="postal-code" maxlength={20} bind:value={draft.address.postal_code} />
            </Field.Field>
            <Field.Field data-invalid={!!errors['address.city'] || undefined}>
              <Field.Label for={uid('city')}>{tr('billing.city')}</Field.Label>
              <Input id={uid('city')} autocomplete="address-level2" maxlength={100} bind:value={draft.address.city} aria-invalid={!!errors['address.city']} />
              {#if errors['address.city']}<Field.Error>{errors['address.city']}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors['address.country'] || undefined}>
              <Field.Label for={uid('country')}>{tr('billing.country')}</Field.Label>
              <Input id={uid('country')} autocomplete="country" maxlength={2} placeholder="EE" bind:value={draft.address.country} aria-invalid={!!errors['address.country']} />
              {#if errors['address.country']}<Field.Error>{errors['address.country']}</Field.Error>{/if}
            </Field.Field>
          </div>
        </Field.Group>
        <div class="flex gap-2">
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{tr('billing.save')}</Button>
          <Button type="button" variant="ghost" onclick={() => (draft = null)}>{tr('billing.cancel')}</Button>
        </div>
      </form>
    {/if}
  </Card.Content>
</Card.Root>
