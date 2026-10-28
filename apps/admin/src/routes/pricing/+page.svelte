<script lang="ts">
  import * as Tabs from '@openrent/ui/tabs';
  import { PageHeader } from '@openrent/ui/openrent';
  import { t } from '#lib';
  import PriceRules from '#lib/components/price-rules.svelte';
  import CouponsManager from '#lib/components/coupons-manager.svelte';
  import FeeRules from '#lib/components/fee-rules.svelte';
  import PriceSuggestions from '#lib/components/price-suggestions.svelte';

  /** Pricing: rules that adjust rental prices, suggested ones, fees and coupon codes. `?tab=` opens a tab. */
  const TABS = ['rules', 'suggestions', 'fees', 'coupons'];
  const asked = new URLSearchParams(location.search).get('tab') ?? '';
  let tab = $state(TABS.includes(asked) ? asked : 'rules');
</script>

<svelte:head><title>{t('nav.pricing')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.pricing')} description={t('pricing.description')} />
<Tabs.Root bind:value={tab} class="gap-6">
  <Tabs.List>
    <Tabs.Trigger value="rules">{t('pricing.tab.rules')}</Tabs.Trigger>
    <Tabs.Trigger value="suggestions">{t('pricing.tab.suggestions')}</Tabs.Trigger>
    <Tabs.Trigger value="fees">{t('pricing.tab.fees')}</Tabs.Trigger>
    <Tabs.Trigger value="coupons">{t('pricing.tab.coupons')}</Tabs.Trigger>
  </Tabs.List>
  <!-- Each tab loads when opened, so a rule made from a suggestion shows under Price rules. -->
  <Tabs.Content value="rules">{#if tab === 'rules'}<PriceRules />{/if}</Tabs.Content>
  <Tabs.Content value="suggestions">{#if tab === 'suggestions'}<PriceSuggestions />{/if}</Tabs.Content>
  <Tabs.Content value="fees">{#if tab === 'fees'}<FeeRules />{/if}</Tabs.Content>
  <Tabs.Content value="coupons">{#if tab === 'coupons'}<CouponsManager />{/if}</Tabs.Content>
</Tabs.Root>
