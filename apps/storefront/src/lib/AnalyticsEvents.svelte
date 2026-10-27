<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { allowAnalytics, track, value, type Item } from './analytics.ts';

  /**
   * Fires the storefront's analytics events from what the pages show (FR-SF-8), so every theme has
   * them: a product seen, an item added, the checkout started and a booking placed in this tab.
   * They only leave the page once the visitor allows analytics (see analytics.ts).
   */
  const STARTED = 'or_checkout_started';
  const route = $derived(page.route.id ?? '');
  const currency = $derived(page.data.shop?.tenant?.currency as string);

  const cartItems = (cart: any): Item[] =>
    (cart?.lines ?? []).map((l: any) => ({ item_id: String(l.variant_id), item_name: String(l.product_name ?? l.name ?? l.description ?? ''), quantity: Number(l.quantity ?? 1) }));

  let seenProduct = '';
  $effect(() => {
    const p = page.data.product;
    if (!route.endsWith('/p/[slug]') || !p || p.id === seenProduct) return;
    seenProduct = p.id;
    const v = p.variants?.[0];
    track({ name: 'view_item', currency, value: value(v?.price?.amount?.amount ?? 0), items: [{ item_id: String(v?.id ?? p.id), item_name: p.name }] });
  });

  let seenCheckout = false;
  $effect(() => {
    if (!route.endsWith('/checkout') || seenCheckout || !page.data.cart) return;
    seenCheckout = true;
    sessionStorage.setItem(STARTED, '1');
    track({ name: 'begin_checkout', currency, value: value(page.data.cart.quote?.totals?.total?.amount ?? 0), items: cartItems(page.data.cart) });
  });

  $effect(() => {
    const o = page.data.order;
    if (!route.endsWith('/order/[token]') || !o?.token) return;
    // Once per booking, and only in the tab that went through checkout.
    const key = `or_purchase_${o.token}`;
    if (!sessionStorage.getItem(STARTED) || localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    sessionStorage.removeItem(STARTED);
    track({
      name: 'purchase', currency: o.currency ?? currency, value: value(o.totals?.total?.amount ?? 0), transaction_id: String(o.number),
      items: (o.lines ?? []).map((l: any) => ({ item_id: String(l.description), item_name: String(l.description), quantity: Number(l.quantity ?? 1) })),
    });
  });

  // The runtime announces each item put in the cart.
  onMount(() => {
    // Allowed earlier and no plugin scripts to load: the DOM events still reach the shop's own code.
    if (!page.data.extensions?.scripts?.length && /(?:^|; )or_consent=all/.test(document.cookie)) allowAnalytics([]);
    const added = (e: Event) => {
      const { variantId, quantity } = (e as CustomEvent<{ variantId: string; quantity: number }>).detail;
      const p = page.data.product;
      const v = p?.variants?.find((x: any) => x.id === variantId);
      track({ name: 'add_to_cart', currency, value: value((v?.price?.amount?.amount ?? 0) * quantity), items: [{ item_id: variantId, item_name: p?.name ?? '', quantity }] });
    };
    window.addEventListener('openrent:cart-added', added);
    return () => window.removeEventListener('openrent:cart-added', added);
  });
</script>
