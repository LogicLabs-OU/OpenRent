<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import { t, toast } from '#lib';
  import { DEFAULT_SCANNER, detectScanner, pauseScans, saveScannerConfig, scannerConfig, type ScannerConfig } from '#lib/scanner.ts';

  /**
   * "Set up scanner" (FR-SCAN-2): one test scan shows what this device's scanner adds before and after
   * the code, which key ends a scan and how fast it types. The result is kept in this browser.
   */
  let open = $state(false);
  let keys = $state<{ key: string; at: number }[]>([]);
  let expected = $state('');
  let current = $state<ScannerConfig>(scannerConfig());
  let idle: ReturnType<typeof setTimeout> | undefined;
  let listening = $state(false);
  const captured = $derived(keys.length > 0 && !listening);
  const detected = $derived(captured ? detectScanner(keys, expected.trim()) : null);

  function onKey(e: KeyboardEvent) {
    if (!listening || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    e.stopPropagation();
    keys = [...keys, { key: e.key, at: performance.now() }];
    clearTimeout(idle);
    idle = setTimeout(() => {
      listening = false;
      expected = keys.filter((k) => k.key.length === 1).map((k) => k.key).join('');
    }, 400);
  }

  function start() {
    keys = [];
    expected = '';
    listening = true;
  }

  $effect(() => {
    pauseScans(open);
    if (open) {
      current = scannerConfig();
      start();
      window.addEventListener('keydown', onKey, true);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      pauseScans(false);
      clearTimeout(idle);
    };
  });

  function save() {
    if (!detected) return;
    saveScannerConfig(detected);
    current = detected;
    toast.success(t('scanner.saved'));
    open = false;
  }

  function reset() {
    saveScannerConfig(null);
    current = DEFAULT_SCANNER;
    toast.success(t('scanner.reset_done'));
    open = false;
  }

  const shown = (s: string) => s || t('scanner.nothing');
  const keyName = (k: ScannerConfig['terminator']) => (k === 'none' ? t('scanner.end.none') : k);
</script>

<Button variant="outline" onclick={() => (open = true)} data-testid="scanner-setup"><SettingsIcon />{t('scanner.setup')}</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{t('scanner.setup')}</Dialog.Title>
      <Dialog.Description>{t('scanner.setup_hint')}</Dialog.Description>
    </Dialog.Header>
    {#if listening}
      <div class="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center" role="status">
        <Spinner />
        <p class="font-medium">{keys.length ? t('scanner.reading') : t('scanner.scan_now')}</p>
      </div>
    {:else if detected}
      <Field.Group>
        <Field.Field>
          <Field.Label for="scan-expected">{t('scanner.printed')}</Field.Label>
          <Input id="scan-expected" class="font-mono" bind:value={expected} data-testid="scanner-expected" />
          <Field.Description>{t('scanner.printed_hint')}</Field.Description>
        </Field.Field>
      </Field.Group>
      <Table.Root data-testid="scanner-detected">
        <Table.Body>
          <Table.Row><Table.Cell>{t('scanner.prefix')}</Table.Cell><Table.Cell class="font-mono">{shown(detected.prefix)}</Table.Cell></Table.Row>
          <Table.Row><Table.Cell>{t('scanner.suffix')}</Table.Cell><Table.Cell class="font-mono">{shown(detected.suffix)}</Table.Cell></Table.Row>
          <Table.Row><Table.Cell>{t('scanner.end')}</Table.Cell><Table.Cell class="font-mono">{keyName(detected.terminator)}</Table.Cell></Table.Row>
          <Table.Row><Table.Cell>{t('scanner.gap')}</Table.Cell><Table.Cell class="font-mono">{t('scanner.ms', { ms: detected.maxGapMs })}</Table.Cell></Table.Row>
        </Table.Body>
      </Table.Root>
    {/if}
    <p class="text-muted-foreground text-xs">{t('scanner.current', { prefix: shown(current.prefix), suffix: shown(current.suffix), end: keyName(current.terminator) })}</p>
    <Dialog.Footer class="flex-row flex-wrap gap-2">
      <Button variant="ghost" onclick={reset}>{t('scanner.reset')}</Button>
      <div class="flex-1"></div>
      {#if !listening}<Button variant="outline" onclick={start}>{t('scanner.again')}</Button>{/if}
      <Button onclick={save} disabled={!detected}>{t('common.save')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
