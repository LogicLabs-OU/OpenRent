<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Card from '../src/components/ui/card/index.js';
  import * as Item from '../src/components/ui/item/index.js';
  import { Button } from '../src/components/ui/button/index.js';
  import StatCard from '../src/components/openrent/stat-card.svelte';

  const { Story } = defineMeta({ title: 'Layout/Cards' });
</script>

<Story name="Card">
  <Card.Root class="max-w-md">
    <Card.Header>
      <Card.Title>Damage waiver</Card.Title>
      <Card.Description>10 % of the rental, when the customer chooses it.</Card.Description>
    </Card.Header>
    <Card.Content><p class="text-sm">Covers damage above the excess of €150.</p></Card.Content>
    <Card.Footer><Button>Save</Button></Card.Footer>
  </Card.Root>
</Story>

<Story name="Stat cards">
  <div class="grid max-w-2xl grid-cols-3 gap-4">
    <StatCard label="Out now" value="12" />
    <StatCard label="Due back today" value="4" hint="2 overdue" />
    <StatCard label="Overdue" value="2" tone="danger" />
  </div>
</Story>

<Story name="Items">
  <Item.Group class="max-w-md">
    <Item.Root variant="outline">
      <Item.Content>
        <Item.Title>Sea kayak</Item.Title>
        <Item.Description>3 of 5 available</Item.Description>
      </Item.Content>
      <Item.Actions><Button size="sm" variant="outline">Open</Button></Item.Actions>
    </Item.Root>
  </Item.Group>
</Story>
