<script lang="ts">
  import { getRuntime, type CartData } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import * as Empty from '@openrent/ui/empty';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import TicketIcon from '@lucide/svelte/icons/ticket';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import { btn, h1 } from '../lib/linen.ts';

  let { data }: { data: CartData } = $props();
  const rt = getRuntime();
  const cart = $derived(data.cart);
  let coupon = $state('');
  const blocked = $derived(cart.availability.some((a) => !a.ok) || !cart.starts_at || !cart.lines.length);
  const name = (l: CartData['cart']['lines'][number]) =>
    `${l.product_name ?? ''}${l.variant_name && l.variant_name !== l.product_name ? ` – ${l.variant_name}` : ''}`;
  const couponReason = (r: string) => {
    const msg = rt.t(`coupon.error.${r}`);
    return msg === `coupon.error.${r}` ? r.replace(/_/g, ' ') : msg;
  };

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
</script>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4 md:mb-12">
  <h1 class={h1}>{rt.t('cart.title')}</h1>
  {#if cart.lines.length}<p class="ln-mono text-sm text-[#666]">{rt.t('hero.items', { count: cart.lines.length })}</p>{/if}
</div>
{#if !cart.lines.length}
  <Empty.Root class="rounded-[20px] bg-[var(--ln-panel)] py-16">
    <Empty.Header>
      <Empty.Media variant="icon" class="bg-white"><ShoppingCartIcon /></Empty.Media>
      <Empty.Title class="ln-display text-2xl">{rt.t('cart.empty')}</Empty.Title>
      <Empty.Description>{rt.t('cart.empty_hint')}</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button class={btn} href={rt.url.home()}>{rt.t('nav.all')}</Button></Empty.Content>
  </Empty.Root>
{:else}
  <div class="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
    <div class="flex flex-col gap-5">
      <div class="grid gap-3 rounded-[20px] bg-[var(--ln-panel)] p-5 sm:grid-cols-2 md:p-6">
        <p class="flex flex-col gap-1">
          <span class="flex items-center gap-2 text-[0.8125rem] font-medium text-[var(--ln-accent)]"
            ><span class="ln-square size-2" aria-hidden="true"></span>{rt.t('dates.pickup')}</span
          >
          <span class="ln-mono text-[0.9375rem]">{rt.format.datetime(cart.starts_at)}</span>
        </p>
        <p class="flex flex-col gap-1">
          <span class="flex items-center gap-2 text-[0.8125rem] font-medium text-[var(--ln-accent)]"
            ><span class="ln-square size-2" aria-hidden="true"></span>{rt.t('dates.return')}</span
          >
          <span class="ln-mono text-[0.9375rem]">{rt.format.datetime(cart.ends_at)}</span>
        </p>
      </div>
      <div class="rounded-[20px] bg-white px-2 py-2 md:px-4">
        <Table.Root data-testid="cart-lines">
          <Table.Header>
            <Table.Row>
              <Table.Head>{rt.t('cart.item')}</Table.Head>
              <Table.Head class="w-24">{rt.t('cart.quantity')}</Table.Head>
              <Table.Head class="text-right">{rt.t('cart.price')}</Table.Head>
              <Table.Head class="w-12"><span class="sr-only">{rt.t('cart.remove')}</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each cart.lines as l, i (l.variant_id)}
              {@const a = cart.availability.find((x) => x.variant_id === l.variant_id)}
              <Table.Row>
                <Table.Cell class="whitespace-normal">
                  <a
                    class="ln-display text-lg underline-offset-4 hover:underline"
                    href={l.product_slug ? rt.url.product(l.product_slug) : undefined}>{name(l)}</a
                  >
                  {#if a && !a.ok}<p class="text-destructive mt-1 text-xs">
                      {a.problems.length
                        ? a.problems.map((p) => p.message).join('; ')
                        : rt.t('cart.only_available', { count: a.available ?? 0 })}
                    </p>{/if}
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    min={0}
                    class="h-8 w-20"
                    value={l.quantity}
                    aria-label={rt.t('cart.quantity')}
                    aria-invalid={a && !a.ok}
                    onchange={(e) =>
                      run(() =>
                        rt.setQuantity(l.variant_id, Number((e.currentTarget as HTMLInputElement).value)),
                      )}
                  />
                </Table.Cell>
                <Table.Cell class="ln-mono text-right"
                  >{cart.quote?.lines[i] ? rt.format.money(cart.quote.lines[i]!.subtotal) : ''}</Table.Cell
                >
                <Table.Cell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={rt.t('cart.remove_item', { name: name(l) })}
                    onclick={() => run(() => rt.setQuantity(l.variant_id, 0))}><Trash2Icon /></Button
                  >
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
      <form
        class="flex max-w-md flex-col gap-1.5"
        onsubmit={(e) => {
          e.preventDefault();
          run(() => rt.applyCoupon(coupon));
        }}
      >
        <InputGroup.Root class="h-11 rounded-full">
          <InputGroup.Addon><TicketIcon /></InputGroup.Addon>
          <InputGroup.Input
            placeholder={rt.t('cart.coupon')}
            aria-label={rt.t('cart.coupon')}
            bind:value={coupon}
            aria-invalid={!!cart.quote?.coupon_errors.length}
          />
          <InputGroup.Addon align="inline-end"
            ><InputGroup.Button type="submit" variant="secondary">{rt.t('cart.apply')}</InputGroup.Button
            ></InputGroup.Addon
          >
        </InputGroup.Root>
        {#each cart.quote?.coupon_errors ?? [] as ce (ce.code)}<p class="text-destructive text-sm">
            {rt.t('cart.coupon_error', { code: ce.code, reason: couponReason(ce.reason) })}
          </p>{/each}
      </form>
    </div>
    <Card.Root class="h-fit lg:sticky lg:top-28">
      <Card.Header><Card.Title class="ln-display text-2xl tracking-[-0.01em]">{rt.t('cart.summary')}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if cart.quote}<PriceSummary quote={cart.quote} />{/if}
        {#if cart.quote_error}<Alert.Root variant="destructive"
            ><CircleAlertIcon /><Alert.Title>{cart.quote_error.message}</Alert.Title></Alert.Root
          >{/if}
      </Card.Content>
      <Card.Footer>
        <Button class={[btn, 'h-12 w-full']} href={rt.url.checkout()} disabled={blocked}
          >{rt.t('cart.checkout')}</Button
        >
      </Card.Footer>
    </Card.Root>
  </div>
{/if}
