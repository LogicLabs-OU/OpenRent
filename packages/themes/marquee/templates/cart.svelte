<script lang="ts">
  import { getRuntime, type CartData } from '@openrent/theme-sdk';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import TicketIcon from '@lucide/svelte/icons/ticket';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import { box, cta, h1, label, pad } from '../lib/marquee.ts';

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

<div class="mb-8 flex items-end justify-between gap-6 border-b border-(--mq-ink) pb-5 md:mb-10">
  <h1 class={h1}>{rt.t('cart.title')}</h1>
  <span class="mq-mono pb-1 text-[clamp(1.5rem,3vw,2.5rem)] leading-none"
    >{pad(cart.lines.reduce((n, l) => n + l.quantity, 0))}</span
  >
</div>
{#if !cart.lines.length}
  <div class="flex flex-col items-start gap-6 border border-(--mq-ink) p-8 md:p-12">
    <p class="mq-tight text-[clamp(2.25rem,5vw,4rem)] leading-[0.9] font-bold uppercase">{rt.t('cart.empty')}</p>
    <p class="text-xl uppercase">{rt.t('cart.empty_hint')}</p>
    <a class="mq-cta flex h-14 items-center gap-6 px-6 text-[1.375rem] font-bold uppercase" href={rt.url.home()}
      >{rt.t('nav.all')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
    >
  </div>
{:else}
  <div class="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-10">
    <div class="flex min-w-0 flex-col gap-6">
      <dl class="mq-cells grid grid-cols-2">
        <div class="flex flex-col gap-1 px-4 py-3">
          <dt class={label}>{rt.t('dates.pickup')}</dt>
          <dd class="mq-mono text-sm md:text-base">{rt.format.datetime(cart.starts_at)}</dd>
        </div>
        <div class="flex flex-col gap-1 px-4 py-3">
          <dt class={label}>{rt.t('dates.return')}</dt>
          <dd class="mq-mono text-sm md:text-base">{rt.format.datetime(cart.ends_at)}</dd>
        </div>
      </dl>
      <div class="border border-(--mq-ink)">
        <Table.Root data-testid="cart-lines" class="text-base">
          <Table.Header>
            <Table.Row class="border-(--mq-ink) hover:bg-transparent">
              <Table.Head class={[label, 'h-11 px-4']}>{rt.t('cart.item')}</Table.Head>
              <Table.Head class={[label, 'h-11 w-24']}>{rt.t('cart.quantity')}</Table.Head>
              <Table.Head class={[label, 'h-11 text-right']}>{rt.t('cart.price')}</Table.Head>
              <Table.Head class="w-12"><span class="sr-only">{rt.t('cart.remove')}</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each cart.lines as l, i (l.variant_id)}
              {@const a = cart.availability.find((x) => x.variant_id === l.variant_id)}
              <Table.Row class="border-(--mq-ink) hover:bg-(--mq-grey)/15">
                <Table.Cell class="px-4 py-4 whitespace-normal">
                  <a
                    class="mq-link mq-tight text-2xl leading-[0.95] font-bold uppercase"
                    href={l.product_slug ? rt.url.product(l.product_slug) : undefined}>{name(l)}</a
                  >
                  {#if a && !a.ok}<p class="text-destructive mt-1 text-sm font-semibold uppercase">
                      {a.problems.length
                        ? a.problems.map((p) => p.message).join('; ')
                        : rt.t('cart.only_available', { count: a.available ?? 0 })}
                    </p>{/if}
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    min={0}
                    class="mq-mono h-10 w-20"
                    value={l.quantity}
                    aria-label={rt.t('cart.quantity')}
                    aria-invalid={a && !a.ok}
                    onchange={(e) =>
                      run(() =>
                        rt.setQuantity(l.variant_id, Number((e.currentTarget as HTMLInputElement).value)),
                      )}
                  />
                </Table.Cell>
                <Table.Cell class="mq-mono text-right text-sm"
                  >{cart.quote?.lines[i] ? rt.format.money(cart.quote.lines[i]!.subtotal) : ''}</Table.Cell
                >
                <Table.Cell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="hover:bg-(--mq-ink) hover:text-(--mq-paper)"
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
        <InputGroup.Root class="h-12 border-(--mq-ink)">
          <InputGroup.Addon><TicketIcon /></InputGroup.Addon>
          <InputGroup.Input
            class="uppercase"
            placeholder={rt.t('cart.coupon')}
            aria-label={rt.t('cart.coupon')}
            bind:value={coupon}
            aria-invalid={!!cart.quote?.coupon_errors.length}
          />
          <InputGroup.Addon align="inline-end" class="pr-0"
            ><InputGroup.Button
              type="submit"
              class="h-12 rounded-none border-l border-(--mq-ink) px-5 text-base font-bold uppercase hover:bg-(--mq-ink) hover:text-(--mq-paper)"
              >{rt.t('cart.apply')}</InputGroup.Button
            ></InputGroup.Addon
          >
        </InputGroup.Root>
        {#each cart.quote?.coupon_errors ?? [] as ce (ce.code)}<p class="text-destructive text-base font-semibold uppercase">
            {rt.t('cart.coupon_error', { code: ce.code, reason: couponReason(ce.reason) })}
          </p>{/each}
      </form>
    </div>
    <section class={[box, 'h-fit lg:sticky lg:top-[calc(var(--mq-head)+1rem)]']} aria-labelledby="or-summary">
      <h2 id="or-summary" class="mq-tight bg-(--mq-ink) px-5 py-3 text-[1.75rem] leading-none font-bold text-(--mq-paper) uppercase">
        {rt.t('cart.summary')}
      </h2>
      <div class="flex flex-col gap-4 p-5">
        {#if cart.quote}<PriceSummary quote={cart.quote} />{/if}
        {#if cart.quote_error}<Alert.Root variant="destructive"
            ><CircleAlertIcon /><Alert.Title>{cart.quote_error.message}</Alert.Title></Alert.Root
          >{/if}
      </div>
      <Button class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} href={rt.url.checkout()} disabled={blocked}
        >{rt.t('cart.checkout')}<ArrowRightIcon class="mq-arrow" /></Button
      >
    </section>
  </div>
{/if}
