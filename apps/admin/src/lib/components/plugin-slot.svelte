<script lang="ts" module>
  import { api } from '#lib';

  export interface SlotEntry {
    plugin_id: string;
    slot: string;
    url: string;
    element: string;
  }

  let slots: Promise<SlotEntry[]> | null = null;
  const scripts = new Map<string, Promise<void>>();

  /** Plugin admin extensions of this shop, loaded once per page load. */
  function allSlots() {
    slots ??= api.get('/plugin_slots').then((r) => r.data as SlotEntry[], () => []);
    return slots;
  }

  /** Loads a bundle once and waits until it defined its element (10 s at most). */
  function ready(s: SlotEntry): Promise<void> {
    let p = scripts.get(s.url);
    if (!p) {
      p = new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.type = 'module';
        el.src = s.url;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(s.url));
        document.head.appendChild(el);
      });
      scripts.set(s.url, p);
    }
    return Promise.race([p.then(() => customElements.whenDefined(s.element)).then(() => undefined), new Promise<void>((_, reject) => setTimeout(() => reject(new Error(s.element)), 10_000))]);
  }
</script>

<script lang="ts">
  import * as Alert from '@openrent/ui/alert';
  import PuzzleIcon from '@lucide/svelte/icons/puzzle';
  import { t } from '#lib';

  /**
   * An outlet for plugins' admin extensions (FR-PLG-2): each plugin's custom element gets the page's
   * `context` (e.g. `{ order_id }`) as a property. A plugin that fails shows a notice, not a broken page.
   */
  let { slot, context = {} }: { slot: string; context?: Record<string, unknown> } = $props();
  let entries = $state<(SlotEntry & { failed: boolean; loaded: boolean })[]>([]);

  $effect(() => {
    const wanted = slot;
    allSlots().then((all) => {
      entries = all.filter((s) => s.slot === wanted).map((s) => ({ ...s, failed: false, loaded: false }));
      for (const e of entries) ready(e).then(
        () => (e.loaded = true),
        () => (e.failed = true),
      );
    });
  });

  /** Hands the context to the element as a property (objects cannot be attributes). */
  function withContext(node: HTMLElement, ctx: Record<string, unknown>) {
    (node as any).context = ctx;
    return { update: (next: Record<string, unknown>) => ((node as any).context = next) };
  }
</script>

{#each entries as e (e.plugin_id + e.element)}
  <svelte:boundary>
    {#if e.failed}
      <Alert.Root data-testid="plugin-slot-failed"><PuzzleIcon /><Alert.Title>{t('plugins.slot_failed', { plugin: e.plugin_id })}</Alert.Title></Alert.Root>
    {:else if e.loaded}
      <svelte:element this={e.element} use:withContext={context} data-plugin={e.plugin_id} data-testid="plugin-slot"></svelte:element>
    {/if}
    {#snippet failed()}
      <Alert.Root data-testid="plugin-slot-failed"><PuzzleIcon /><Alert.Title>{t('plugins.slot_failed', { plugin: e.plugin_id })}</Alert.Title></Alert.Root>
    {/snippet}
  </svelte:boundary>
{/each}
