<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Table from '../src/components/ui/table/index.js';
  import * as Pagination from '../src/components/ui/pagination/index.js';
  import Money from '../src/components/openrent/money.svelte';

  const { Story } = defineMeta({ title: 'Data/Table' });
  const rows = [
    { n: 1042, customer: 'Mari Tamm', total: 12500 },
    { n: 1043, customer: 'Bühne GmbH', total: 98000 },
    { n: 1044, customer: 'Kai Owner', total: 3600 },
  ];
</script>

<Story name="Orders">
  <Table.Root>
    <Table.Caption>Orders this week</Table.Caption>
    <Table.Header>
      <Table.Row><Table.Head>Order</Table.Head><Table.Head>Customer</Table.Head><Table.Head class="text-right">Total</Table.Head></Table.Row>
    </Table.Header>
    <Table.Body>
      {#each rows as r (r.n)}
        <Table.Row><Table.Cell>#{r.n}</Table.Cell><Table.Cell>{r.customer}</Table.Cell><Table.Cell class="text-right"><Money value={{ amount: r.total, currency: 'EUR' }} /></Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</Story>

<Story name="Pagination">
  <Pagination.Root count={120} perPage={20} page={2}>
    {#snippet children({ pages, currentPage })}
      <Pagination.Content>
        <Pagination.Item><Pagination.PrevButton /></Pagination.Item>
        {#each pages as p (p.key)}
          <Pagination.Item>
            {#if p.type === 'ellipsis'}<Pagination.Ellipsis />{:else}<Pagination.Link page={p} isActive={currentPage === p.value}>{p.value}</Pagination.Link>{/if}
          </Pagination.Item>
        {/each}
        <Pagination.Item><Pagination.NextButton /></Pagination.Item>
      </Pagination.Content>
    {/snippet}
  </Pagination.Root>
</Story>
