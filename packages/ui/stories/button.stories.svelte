<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { Button } from '../src/components/ui/button/index.js';
  import * as ButtonGroup from '../src/components/ui/button-group/index.js';

  const { Story } = defineMeta({ title: 'Actions/Button' });
</script>

<Story name="Variants">
  <div class="flex flex-wrap gap-2">
    <Button>Save</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="link">Link</Button>
    <Button variant="destructive">Delete</Button>
  </div>
</Story>

<Story name="Sizes and icons">
  <div class="flex flex-wrap items-center gap-2">
    <Button size="sm"><PlusIcon />New order</Button>
    <Button><PlusIcon />New order</Button>
    <Button size="lg">Book now</Button>
    <Button size="icon" variant="outline" aria-label="Remove line"><TrashIcon /></Button>
    <Button disabled>Saving…</Button>
  </div>
</Story>

<Story name="Group">
  <ButtonGroup.Root aria-label="View">
    <Button variant="outline">Day</Button>
    <Button variant="outline">Week</Button>
    <Button variant="outline">Month</Button>
  </ButtonGroup.Root>
</Story>
