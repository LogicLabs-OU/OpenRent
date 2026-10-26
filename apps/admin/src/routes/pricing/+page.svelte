<script lang="ts">
  import * as Tabs from '@openrent/ui/tabs';
  import { PageHeader } from '@openrent/ui/openrent';
  import { t } from '#lib';
  import PriceRules from '#lib/components/price-rules.svelte';
  import CouponsManager from '#lib/components/coupons-manager.svelte';
  import FeeRules from '#lib/components/fee-rules.svelte';

  /** Pricing: rules that adjust rental prices, fees and coupon codes. `?tab=fees` or `?tab=coupons` opens that tab. */
  const TABS = ['rules', 'fees', 'coupons'];
  const asked = new URLSearchParams(location.search).get('tab') ?? '';
  let tab = $state(TABS.includes(asked) ? asked : 'rules');
</script>

<svelte:head><title>{t('nav.pricing')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.pricing')} description={t('pricing.description')} />
<Tabs.Root bind:value={tab} class="gap-6">
  <Tabs.List>
    <Tabs.Trigger value="rules">{t('pricing.tab.rules')}</Tabs.Trigger>
    <Tabs.Trigger value="fees">{t('pricing.tab.fees')}</Tabs.Trigger>
    <Tabs.Trigger value="coupons">{t('pricing.tab.coupons')}</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="rules"><PriceRules /></Tabs.Content>
  <Tabs.Content value="fees"><FeeRules /></Tabs.Content>
  <Tabs.Content value="coupons"><CouponsManager /></Tabs.Content>
</Tabs.Root>
