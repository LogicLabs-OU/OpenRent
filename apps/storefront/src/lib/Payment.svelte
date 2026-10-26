<script lang="ts">
  import { onMount } from 'svelte';
  // The pure entry loads Stripe.js only when a payment form opens, not on every page (and only where CSP allows it).
  import { loadStripe } from '@stripe/stripe-js/pure';
  import type { Stripe, StripeElements } from '@stripe/stripe-js';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { t } from './i18n/index.ts';
  import { getRuntime } from '@openrent/theme-sdk';

  const rt = getRuntime();
  let { clientSecret, publishableKey, returnUrl, onerror }: { clientSecret: string; publishableKey: string; returnUrl: string; onerror?: (m: string) => void } = $props();
  let el: HTMLDivElement | undefined = $state();
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let ready = $state(false);
  let busy = $state(false);

  /** Stripe's Appearance API needs concrete colours, so the theme's CSS variables are resolved first. */
  function cssColor(name: string, fallback: string) {
    if (!el) return fallback;
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    el.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c || fallback;
  }

  onMount(async () => {
    // Stripe's own field labels follow the storefront language.
    stripe = await loadStripe(publishableKey, { locale: rt.shop.locale as 'auto' });
    if (!stripe || !el) return onerror?.(t('payment.load_failed', {}, rt.shop.locale));
    const radius = getComputedStyle(el).getPropertyValue('--radius').trim() || '0.625rem';
    elements = stripe.elements({
      clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: cssColor('--primary', '#0e7490'),
          colorText: cssColor('--foreground', '#0a0a0a'),
          colorDanger: cssColor('--destructive', '#dc2626'),
          fontFamily: 'Inter Variable, system-ui, sans-serif',
          borderRadius: radius,
        },
      },
    });
    const payment = elements.create('payment', { layout: 'tabs' });
    payment.mount(el);
    payment.on('ready', () => (ready = true));
  });

  async function pay() {
    if (!stripe || !elements) return;
    busy = true;
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
    // On success Stripe redirects to returnUrl; an error stays on the page.
    if (error) onerror?.(error.message ?? t('payment.failed', {}, rt.shop.locale));
    busy = false;
  }
</script>

<div class="flex flex-col gap-4">
  <div bind:this={el} class="min-h-32"></div>
  <Button size="lg" class="w-full" disabled={!ready || busy} onclick={pay}>
    {#if busy}<Spinner />{t('payment.processing', {}, rt.shop.locale)}{:else}<LockIcon />{t('payment.pay_now', {}, rt.shop.locale)}{/if}
  </Button>
  <p class="text-muted-foreground text-center text-xs">{t('payment.secure', {}, rt.shop.locale)}</p>
</div>
