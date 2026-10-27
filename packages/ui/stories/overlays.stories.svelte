<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Dialog from '../src/components/ui/dialog/index.js';
  import * as AlertDialog from '../src/components/ui/alert-dialog/index.js';
  import * as Popover from '../src/components/ui/popover/index.js';
  import * as DropdownMenu from '../src/components/ui/dropdown-menu/index.js';
  import * as Sheet from '../src/components/ui/sheet/index.js';
  import * as Tooltip from '../src/components/ui/tooltip/index.js';
  import { Button } from '../src/components/ui/button/index.js';
  import { Input } from '../src/components/ui/input/index.js';
  import { Label } from '../src/components/ui/label/index.js';

  const { Story } = defineMeta({ title: 'Overlays/Open' });
</script>

<Story name="Dialog">
  <Dialog.Root open>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>New fee</Dialog.Title>
        <Dialog.Description>Added to quotes when it applies.</Dialog.Description>
      </Dialog.Header>
      <div class="flex flex-col gap-2"><Label for="o-fee">Name</Label><Input id="o-fee" value="Cleaning" /></div>
      <Dialog.Footer><Button variant="outline">Cancel</Button><Button>Save</Button></Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Confirmation">
  <AlertDialog.Root open>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Cancel order #1042?</AlertDialog.Title>
        <AlertDialog.Description>The units go back into stock.</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
        <AlertDialog.Action>Cancel order</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</Story>

<Story name="Popover and menu">
  <div class="flex gap-4">
    <Popover.Root open>
      <Popover.Trigger>{#snippet child({ props })}<Button variant="outline" {...props}>Dates</Button>{/snippet}</Popover.Trigger>
      <Popover.Content><p class="text-sm">Pick the pickup and return.</p></Popover.Content>
    </Popover.Root>
  </div>
</Story>

<Story name="Menu">
  <DropdownMenu.Root open>
    <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="outline" {...props}>More</Button>{/snippet}</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Label>Order</DropdownMenu.Label>
      <DropdownMenu.Item>Duplicate</DropdownMenu.Item>
      <DropdownMenu.Item>Print</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Story>

<Story name="Sheet">
  <Sheet.Root open>
    <Sheet.Content>
      <Sheet.Header>
        <Sheet.Title>Filters</Sheet.Title>
        <Sheet.Description>Narrow the order list.</Sheet.Description>
      </Sheet.Header>
    </Sheet.Content>
  </Sheet.Root>
</Story>

<Story name="Tooltip">
  <Tooltip.Provider>
    <Tooltip.Root open>
      <Tooltip.Trigger>{#snippet child({ props })}<Button variant="outline" {...props}>Hover me</Button>{/snippet}</Tooltip.Trigger>
      <Tooltip.Content>Ready to go out</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
</Story>
