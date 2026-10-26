<script lang="ts">
  /** Beige stand-in for a missing photo: a faint grid, the name's initial, an orange square and a mono index. */
  let { name, index = 0, size = 'md' }: { name: string; index?: number; size?: 'md' | 'lg' } = $props();
  const initial = $derived([...name.trim()][0]?.toUpperCase() ?? '');
</script>

<div class="ln-grid relative size-full overflow-hidden" aria-hidden="true">
  <span class="ln-square absolute top-4 left-4"></span>
  <span class="ln-mono absolute top-3 right-4 text-[0.6875rem] text-[#202020]/45"
    ><!-- i18n-ignore -->{String(index + 1).padStart(2, '0')}</span
  >
  <span
    class={[
      'ln-display absolute bottom-0 left-4 leading-[0.78] tracking-[-0.04em] text-[#202020]/[0.09] select-none',
      size === 'lg' ? 'text-[16rem] md:text-[22rem]' : 'text-[9rem]',
    ]}>{initial}</span
  >
  <svg class="absolute right-5 bottom-5 w-[34%] text-[#202020]/12" viewBox="0 0 120 80" fill="none"
    ><path d="M2 78C30 78 34 30 62 30s30 48 56 48" stroke="currentColor" stroke-width="1.5" /><circle
      cx="62"
      cy="30"
      r="3.5"
      fill="var(--ln-signal)"
    /></svg
  >
</div>
