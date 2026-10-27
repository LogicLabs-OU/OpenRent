<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import PackageIcon from '@lucide/svelte/icons/package';
  import * as Alert from '../src/components/ui/alert/index.js';
  import { Badge } from '../src/components/ui/badge/index.js';
  import { Spinner } from '../src/components/ui/spinner/index.js';
  import { Progress } from '../src/components/ui/progress/index.js';
  import { Skeleton } from '../src/components/ui/skeleton/index.js';
  import * as Empty from '../src/components/ui/empty/index.js';
  import { Kbd } from '../src/components/ui/kbd/index.js';
  import { Button } from '../src/components/ui/button/index.js';
  import StatusBadge from '../src/components/openrent/status-badge.svelte';

  const { Story } = defineMeta({ title: 'Feedback/Status' });
</script>

<Story name="Alerts">
  <div class="flex max-w-lg flex-col gap-3">
    <Alert.Root><Alert.Title>Prices include VAT</Alert.Title><Alert.Description>Change it per language under Settings.</Alert.Description></Alert.Root>
    <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>The card was declined</Alert.Title></Alert.Root>
  </div>
</Story>

<Story name="Badges">
  <div class="flex flex-wrap gap-2">
    <Badge>New</Badge>
    <Badge variant="secondary">Draft</Badge>
    <Badge variant="outline">Optional</Badge>
    <Badge variant="destructive">Overdue</Badge>
    <StatusBadge status="reserved" />
    <StatusBadge status="checked_out" />
    <StatusBadge status="overdue" />
    <StatusBadge status="cancelled" />
  </div>
</Story>

<Story name="Loading">
  <div class="flex max-w-md flex-col gap-4">
    <div class="flex items-center gap-2 text-sm"><Spinner />Loading bookings</div>
    <Progress value={60} aria-label="Orders this month" />
    <Skeleton class="h-6 w-48" />
    <p class="text-sm">Search with <Kbd>/</Kbd></p>
  </div>
</Story>

<Story name="Empty state">
  <Empty.Root class="max-w-md border">
    <Empty.Header>
      <Empty.Media variant="icon"><PackageIcon /></Empty.Media>
      <Empty.Title>No products yet</Empty.Title>
      <Empty.Description>Add the first thing you rent out.</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button>New product</Button></Empty.Content>
  </Empty.Root>
</Story>
