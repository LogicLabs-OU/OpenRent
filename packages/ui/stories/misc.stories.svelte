<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Avatar from '../src/components/ui/avatar/index.js';
  import * as Collapsible from '../src/components/ui/collapsible/index.js';
  import { Calendar } from '../src/components/ui/calendar/index.js';
  import { Button } from '../src/components/ui/button/index.js';
  import Money from '../src/components/openrent/money.svelte';

  const { Story } = defineMeta({ title: 'Misc/Pieces' });
</script>

<Story name="Avatar and money">
  <div class="flex items-center gap-4">
    <Avatar.Root><Avatar.Fallback>MT</Avatar.Fallback></Avatar.Root>
    <span class="text-lg"><Money value={{ amount: 123456, currency: 'EUR' }} /></span>
  </div>
</Story>

<Story name="Collapsible">
  <Collapsible.Root open class="max-w-md">
    <Collapsible.Trigger>{#snippet child({ props })}<Button variant="ghost" {...props}>Advanced</Button>{/snippet}</Collapsible.Trigger>
    <Collapsible.Content><p class="text-sm">Buffer times and minimum notice.</p></Collapsible.Content>
  </Collapsible.Root>
</Story>

<Story name="Calendar">
  <Calendar type="single" class="rounded-md border" />
</Story>
