<script lang="ts">
  import { cn } from '#ui/utils.js';
  import { Button } from '#ui/components/ui/button/index.js';
  import EraserIcon from '@lucide/svelte/icons/eraser';
  import UndoIcon from '@lucide/svelte/icons/undo-2';

  /**
   * Drawn signature on a canvas (mouse, pen or finger). `empty` tells whether anything is drawn;
   * `toBlob()` returns a transparent PNG trimmed to the strokes.
   */
  let {
    empty = $bindable(true),
    label,
    clearLabel,
    undoLabel,
    class: className,
  }: { empty?: boolean; label: string; clearLabel: string; undoLabel: string; class?: string } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let strokes: { x: number; y: number }[][] = [];
  let drawing = false;

  function ctx2d() {
    const c = canvas!.getContext('2d')!;
    c.lineWidth = 2.2 * devicePixelRatio;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = getComputedStyle(canvas!).color || '#0a0a0a';
    return c;
  }

  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * devicePixelRatio);
    canvas.height = Math.round(r.height * devicePixelRatio);
    redraw();
  }

  function redraw() {
    const c = ctx2d();
    c.clearRect(0, 0, canvas!.width, canvas!.height);
    for (const s of strokes) {
      c.beginPath();
      s.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (s.length === 1) c.lineTo(s[0]!.x + 0.1, s[0]!.y);
      c.stroke();
    }
    empty = strokes.length === 0;
  }

  const point = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * devicePixelRatio, y: (e.clientY - r.top) * devicePixelRatio };
  };

  function down(e: PointerEvent) {
    canvas!.setPointerCapture(e.pointerId);
    drawing = true;
    strokes.push([point(e)]);
    redraw();
  }
  function move(e: PointerEvent) {
    if (!drawing) return;
    strokes.at(-1)!.push(point(e));
    redraw();
  }
  function up() {
    drawing = false;
  }

  export function clear() {
    strokes = [];
    redraw();
  }
  function undo() {
    strokes.pop();
    redraw();
  }

  /** PNG of the drawn strokes, cropped with a small margin. */
  export async function toBlob(): Promise<Blob | null> {
    if (!canvas || !strokes.length) return null;
    const pts = strokes.flat();
    const pad = 8 * devicePixelRatio;
    const minX = Math.max(0, Math.min(...pts.map((p) => p.x)) - pad);
    const minY = Math.max(0, Math.min(...pts.map((p) => p.y)) - pad);
    const w = Math.min(canvas.width, Math.max(...pts.map((p) => p.x)) + pad) - minX;
    const h = Math.min(canvas.height, Math.max(...pts.map((p) => p.y)) + pad) - minY;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w));
    out.height = Math.max(1, Math.round(h));
    out.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
  }

  $effect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas) ro.observe(canvas);
    return () => ro.disconnect();
  });
</script>

<div class={cn('flex flex-col gap-2', className)} data-slot="signature-pad">
  <canvas
    bind:this={canvas}
    class="bg-background text-foreground h-36 w-full touch-none rounded-md border border-dashed"
    aria-label={label}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  ></canvas>
  <div class="flex justify-end gap-1">
    <Button type="button" variant="ghost" size="sm" disabled={empty} onclick={undo}><UndoIcon />{undoLabel}</Button>
    <Button type="button" variant="ghost" size="sm" disabled={empty} onclick={clear}><EraserIcon />{clearLabel}</Button>
  </div>
</div>
