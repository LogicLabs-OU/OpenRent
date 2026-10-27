<script lang="ts">
  import { getRuntime, type Cart } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Input } from '@openrent/ui/input';
  import { toast } from 'svelte-sonner';

  /** Extras the shop offers for this cart (theme API 1.5): damage waiver, delivery and so on, with the delivery postcode. */
  let { cart, titleClass = '' }: { cart: Cart; titleClass?: string } = $props();
  const rt = getRuntime();
  const offers = $derived(cart.quote?.optional_fees ?? []);
  const chosen = $derived(cart.options?.fees ?? []);
  const delivery = $derived(offers.some((f) => f.kind === 'delivery' && chosen.includes(f.id)));
  const problem = $derived(cart.quote?.fee_errors?.[0]?.reason ?? null);
  // A delivery by distance (theme API 1.8) needs the address; its problems show there.
  const postcodeProblem = $derived(problem?.startsWith('postcode_') ? problem : null);
  const addressProblem = $derived(problem?.startsWith('address_') ? problem : null);
  // svelte-ignore state_referenced_locally
  let postcode = $state(cart.options?.postcode ?? '');
  // svelte-ignore state_referenced_locally
  let address = $state(cart.options?.address ?? '');
  let busy = $state(false);

  async function save(options: { fees?: string[]; postcode?: string | null; address?: string | null }) {
    busy = true;
    try {
      await rt.setOptions?.(options);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      busy = false;
    }
  }
  const toggle = (id: string, on: boolean) => save({ fees: on ? [...chosen, id] : chosen.filter((x) => x !== id) });
  function savePostcode() {
    if (postcode.trim() !== (cart.options?.postcode ?? '')) save({ postcode: postcode.trim() || null });
  }
  function saveAddress() {
    if (address.trim() !== (cart.options?.address ?? '')) save({ address: address.trim() || null });
  }
</script>

{#if offers.length && rt.setOptions}
  <Card.Root data-testid="optional-fees">
    <Card.Header>
      <Card.Title class={titleClass}>{rt.t('fees.title')}</Card.Title>
      <Card.Description>{rt.t('fees.hint')}</Card.Description>
    </Card.Header>
    <Card.Content>
      <Field.Group>
        {#each offers as f (f.id)}
          <Field.Field orientation="horizontal">
            <Checkbox id={`or-fee-${f.id}`} checked={f.selected} disabled={busy} onCheckedChange={(v) => toggle(f.id, v === true)} />
            <Field.Label for={`or-fee-${f.id}`} class="flex-1 justify-between font-normal">
              {f.name}
              <span class="text-muted-foreground tabular-nums">{f.kind === 'delivery' && !f.amount.amount ? rt.t(f.priced_by === 'distance' ? 'fees.by_distance' : 'fees.by_postcode') : rt.format.money(f.amount)}</span>
            </Field.Label>
          </Field.Field>
        {/each}
        {#if delivery}
          <Field.Field data-invalid={!!postcodeProblem || undefined}>
            <Field.Label for="or-fee-postcode">{rt.t('fees.postcode')}</Field.Label>
            <Input id="or-fee-postcode" class="max-w-40" autocomplete="postal-code" bind:value={postcode} onblur={savePostcode} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), savePostcode())} aria-invalid={!!postcodeProblem} />
            {#if postcodeProblem}<Field.Error>{rt.t(`fees.${postcodeProblem}`)}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!addressProblem || undefined}>
            <Field.Label for="or-fee-address">{rt.t('fees.address')}</Field.Label>
            <Input id="or-fee-address" autocomplete="street-address" bind:value={address} onblur={saveAddress} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), saveAddress())} aria-invalid={!!addressProblem} />
            {#if addressProblem}<Field.Error>{rt.t(`fees.${addressProblem}`)}</Field.Error>{/if}
          </Field.Field>
        {/if}
      </Field.Group>
    </Card.Content>
  </Card.Root>
{/if}
