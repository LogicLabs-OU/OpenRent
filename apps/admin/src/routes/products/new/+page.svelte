<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader } from '@openrent/ui/openrent';
  import { api, session, t, toast, notifyError, fieldErrors, minorFromInput } from '#lib';
  import { to } from '#lib/nav.ts';
  import BundleComponents, { type BundleComponent } from '#lib/components/bundle-components.svelte';

  let cats = $state<any[]>([]);
  let f = $state({
    type: 'rental', name: '', description: '', tracking: 'serialized', kind: 'per_period', period: 'day', amount: '', tier2: '50', capEvery: '', capCharge: '',
    deposit: '', bufferAfter: '0', minDuration: '', category: '', units: '1', bulkQty: '10', visibility: 'public',
  });
  let components = $state<BundleComponent[]>([]);
  let discount = $state('10');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  onMount(async () => {
    cats = (await api.get('/categories?limit=200')).data;
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const amount = minorFromInput(f.amount || '0');
      const price: any =
        f.kind === 'tiered'
          ? { kind: 'tiered', period_unit: f.period, amount, tiers: [{ from: 1, pct_bp: 10000 }, { from: 2, pct_bp: Math.round(Number(f.tier2) * 100) }], cap: f.capEvery ? { every: Number(f.capEvery), charge: Number(f.capCharge || f.capEvery) } : null }
          : { kind: f.kind, period_unit: f.period, amount };
      const body: any = {
        type: f.type, name: f.name, description: f.description, visibility: f.visibility, category_ids: f.category ? [f.category] : [],
        deposit_amount: f.deposit ? minorFromInput(f.deposit) : 0, buffer_after_min: Number(f.bufferAfter || 0), min_duration_min: f.minDuration ? Number(f.minDuration) * 60 : null,
      };
      if (f.type === 'bundle') {
        const comps = components.map((c) => ({ variant_id: c.variant_id, quantity: Number(c.quantity), slot_name: c.slot_name.trim() || null }));
        body.bundle = { pricing_mode: Number(discount) > 0 ? 'discount_pct' : 'sum', discount_bp: Math.round(Number(discount) * 100), components: comps };
      }
      else {
        body.price = f.type === 'rental' ? price : { kind: 'fixed', period_unit: 'day', amount };
        body.tracking = f.type === 'service' ? 'none' : f.type === 'rental' ? f.tracking : 'bulk';
      }
      const p = await api.post('/products', body);
      const v = p.variants[0];
      if (v.tracking === 'serialized' && Number(f.units) > 0) await api.post('/stock_items/batch', { variant_id: v.id, location_id: session.locations[0]?.id, count: Number(f.units) });
      if (v.tracking === 'bulk' && Number(f.bulkQty) > 0) await api.put(`/stock_levels/${v.id}/${session.locations[0]?.id}`, { quantity: Number(f.bulkQty), reason: t('inventory.reason_initial_stock') });
      toast.success(t('product.toast.created', { name: p.name }));
      goto(to(`/products/${p.id}`));
    } catch (err) {
      errors = fieldErrors(err);
      notifyError(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{t('products.new')} · OpenRent</title></svelte:head>
<PageHeader title={t('products.new')} description={t('products.new_description')} />

<form onsubmit={submit} class="grid max-w-3xl gap-6">
  <Card.Root>
    <Card.Header><Card.Title>{t('product.basics')}</Card.Title></Card.Header>
    <Card.Content>
      <Field.Group class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="type">{t('field.type')}</Field.Label>
          <NativeSelect.Root id="type" class="w-full" bind:value={f.type}>{#each ['rental', 'bundle', 'sale', 'consumable', 'service'] as x}<NativeSelect.Option value={x}>{t(`product.type_long.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
        </Field.Field>
        <Field.Field data-invalid={!!errors.name || undefined}>
          <Field.Label for="name">{t('field.name')}</Field.Label>
          <Input id="name" required bind:value={f.name} aria-invalid={!!errors.name || undefined} />
          {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
        </Field.Field>
        <Field.Field class="sm:col-span-2"><Field.Label for="desc">{t('field.description')}</Field.Label><Textarea id="desc" bind:value={f.description} /></Field.Field>
        <Field.Field>
          <Field.Label for="cat">{t('product.category')}</Field.Label>
          <NativeSelect.Root id="cat" class="w-full" bind:value={f.category}><NativeSelect.Option value="">{t('common.none')}</NativeSelect.Option>{#each cats as c (c.id)}<NativeSelect.Option value={c.id}>{c.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
        </Field.Field>
        <Field.Field>
          <Field.Label for="vis">{t('product.visibility')}</Field.Label>
          <NativeSelect.Root id="vis" class="w-full" bind:value={f.visibility}><NativeSelect.Option value="public">{t('visibility.public_long')}</NativeSelect.Option><NativeSelect.Option value="hidden">{t('visibility.hidden_long')}</NativeSelect.Option></NativeSelect.Root>
        </Field.Field>
      </Field.Group>
    </Card.Content>
  </Card.Root>

  {#if f.type === 'bundle'}
    <Card.Root>
      <Card.Header><Card.Title>{t('product.components')}</Card.Title><Card.Description>{t('product.components_hint')}</Card.Description></Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <BundleComponents bind:components {errors} />
        <Field.Field class="max-w-48"><Field.Label for="disc">{t('product.bundle_discount_label')}</Field.Label><Input id="disc" inputmode="decimal" bind:value={discount} /></Field.Field>
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root>
      <Card.Header><Card.Title>{t('product.price')}</Card.Title></Card.Header>
      <Card.Content>
        <Field.Group class="grid gap-4 sm:grid-cols-3">
          {#if f.type === 'rental'}
            <Field.Field>
              <Field.Label for="kind">{t('product.structure')}</Field.Label>
              <NativeSelect.Root id="kind" class="w-full" bind:value={f.kind}>{#each ['per_period', 'tiered', 'fixed'] as k}<NativeSelect.Option value={k}>{t(`structure.${k}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
            {#if f.kind !== 'fixed'}
              <Field.Field>
                <Field.Label for="per">{t('product.period')}</Field.Label>
                <NativeSelect.Root id="per" class="w-full" bind:value={f.period}>{#each ['hour', 'day', 'week', 'month'] as p}<NativeSelect.Option value={p}>{t(`period.${p}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
              </Field.Field>
            {/if}
          {/if}
          <Field.Field><Field.Label for="amt">{t('product.price')} ({session.currency})</Field.Label><Input id="amt" required inputmode="decimal" bind:value={f.amount} /></Field.Field>
          {#if f.kind === 'tiered' && f.type === 'rental'}
            <Field.Field><Field.Label for="t2">{t('product.tier2')}</Field.Label><Input id="t2" inputmode="decimal" bind:value={f.tier2} /></Field.Field>
            <Field.Field><Field.Label for="ce">{t('product.cap_every')}</Field.Label><Input id="ce" inputmode="numeric" bind:value={f.capEvery} /><Field.Description>{t('product.cap_every_hint')}</Field.Description></Field.Field>
            <Field.Field><Field.Label for="cc">{t('product.cap_charge')}</Field.Label><Input id="cc" inputmode="decimal" bind:value={f.capCharge} /><Field.Description>{t('product.cap_charge_hint')}</Field.Description></Field.Field>
          {/if}
        </Field.Group>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if f.type === 'rental' || f.type === 'bundle'}
    <Card.Root>
      <Card.Header><Card.Title>{t('product.rules')}</Card.Title></Card.Header>
      <Card.Content>
        <Field.Group class="grid gap-4 sm:grid-cols-3">
          {#if f.type === 'rental'}
            <Field.Field class="sm:col-span-3">
              <Field.Label for="trk">{t('product.tracking')}</Field.Label>
              <NativeSelect.Root id="trk" class="w-full" bind:value={f.tracking}><NativeSelect.Option value="serialized">{t('tracking.serialized_long')}</NativeSelect.Option><NativeSelect.Option value="bulk">{t('tracking.bulk_long')}</NativeSelect.Option></NativeSelect.Root>
            </Field.Field>
          {/if}
          <Field.Field><Field.Label for="dep">{t('product.deposit')} ({session.currency})</Field.Label><Input id="dep" inputmode="decimal" bind:value={f.deposit} /></Field.Field>
          <Field.Field><Field.Label for="buf">{t('product.buffer_after')}</Field.Label><Input id="buf" inputmode="numeric" bind:value={f.bufferAfter} /></Field.Field>
          <Field.Field><Field.Label for="mind">{t('product.min_hours')}</Field.Label><Input id="mind" inputmode="numeric" bind:value={f.minDuration} /></Field.Field>
          {#if f.type === 'rental' && f.tracking === 'serialized'}<Field.Field><Field.Label for="un">{t('product.create_units')}</Field.Label><Input id="un" type="number" min="0" max="100" bind:value={f.units} /></Field.Field>{/if}
          {#if f.type === 'rental' && f.tracking === 'bulk'}<Field.Field><Field.Label for="bq">{t('product.quantity_in_stock')}</Field.Label><Input id="bq" type="number" min="0" bind:value={f.bulkQty} /></Field.Field>{/if}
        </Field.Group>
      </Card.Content>
    </Card.Root>
  {/if}
  <div><Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('products.create')}</Button></div>
</form>
