<script lang="ts">
  import { onMount } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { reducedMotion } from '../lib/motion.ts';

  /**
   * The home page's opening count: a giant 000 → 100 in the bottom-right corner and a blue rule across the top,
   * while the hero poster wobbles on its pin. Once per session, about a second, never takes clicks, and any
   * click, key or scroll ends it. Nothing is hidden: the page underneath is already there.
   */
  const rt = getRuntime();
  const KEY = 'mq-intro';
  const MS = 850;
  let n = $state(0);
  let running = $state(false);
  let out = $state(false);

  onMount(() => {
    if (rt.shop.settings.intro === false || reducedMotion()) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, '1');
    } catch {
      return;
    }
    running = true;
    const root = document.documentElement;
    root.classList.add('mq-intro-run');
    const start = performance.now();
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (out) return;
      cancelAnimationFrame(frame);
      n = 100;
      out = true;
      timer = setTimeout(stop, 360);
    };
    const stop = () => {
      running = false;
      root.classList.remove('mq-intro-run');
      for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) removeEventListener(e, finish);
    };
    for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const)
      addEventListener(e, finish, { passive: true });
    frame = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - start) / MS);
      n = Math.round(100 * (1 - (1 - k) ** 2));
      if (k < 1) frame = requestAnimationFrame(tick);
      else finish();
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stop();
    };
  });
</script>

{#if running}
  <div class="mq-intro mq-font" data-out={out || undefined} aria-hidden="true">
    <div class="mq-intro-bar" style:transform={`scaleX(${n / 100})`}></div>
    <div class="mq-intro-count mq-tight">{String(n).padStart(3, '0')}</div>
  </div>
{/if}
