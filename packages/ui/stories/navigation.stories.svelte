<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Tabs from '../src/components/ui/tabs/index.js';
  import * as Breadcrumb from '../src/components/ui/breadcrumb/index.js';
  import * as ToggleGroup from '../src/components/ui/toggle-group/index.js';
  import PageHeader from '../src/components/openrent/page-header.svelte';
  import { Button } from '../src/components/ui/button/index.js';
  import { Separator } from '../src/components/ui/separator/index.js';

  const { Story } = defineMeta({ title: 'Navigation/Page' });
</script>

<Story name="Page header and tabs">
  <PageHeader title="Settings" description="How your shop works.">
    {#snippet actions()}<Button>Save</Button>{/snippet}
  </PageHeader>
  <Tabs.Root value="general">
    <Tabs.List>
      <Tabs.Trigger value="general">General</Tabs.Trigger>
      <Tabs.Trigger value="email">Email</Tabs.Trigger>
      <Tabs.Trigger value="payments">Payments</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="general"><p class="text-sm">Name, address and languages.</p></Tabs.Content>
    <Tabs.Content value="email"><p class="text-sm">Templates and sending.</p></Tabs.Content>
    <Tabs.Content value="payments"><p class="text-sm">Providers and terms.</p></Tabs.Content>
  </Tabs.Root>
</Story>

<Story name="Breadcrumb and toggles">
  <div class="flex flex-col gap-4">
    <Breadcrumb.Root>
      <Breadcrumb.List>
        <Breadcrumb.Item><Breadcrumb.Link href="#orders">Orders</Breadcrumb.Link></Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item><Breadcrumb.Page>#1042</Breadcrumb.Page></Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb.Root>
    <Separator />
    <ToggleGroup.Root type="single" value="list" aria-label="Show as">
      <ToggleGroup.Item value="list">List</ToggleGroup.Item>
      <ToggleGroup.Item value="board">Board</ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
</Story>
