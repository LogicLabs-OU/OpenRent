<script lang="ts">
  import * as AlertDialog from '@openrent/ui/alert-dialog';
  import { confirmState } from '#lib/confirm.svelte.ts';
  import { t } from '#lib/i18n/index.svelte.ts';
</script>

<AlertDialog.Root open={confirmState.open} onOpenChange={(o) => !o && confirmState.settle(false)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{confirmState.request?.title}</AlertDialog.Title>
      <AlertDialog.Description>{confirmState.request?.description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => confirmState.settle(false)}>{t('common.cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action variant={confirmState.request?.destructive ? 'destructive' : 'default'} onclick={() => confirmState.settle(true)}>
        {confirmState.request?.confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
