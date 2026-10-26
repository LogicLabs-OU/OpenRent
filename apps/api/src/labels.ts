import bwipjs from 'bwip-js';

export interface LabelItem {
  code: string;
  title: string;
  subtitle: string;
}

const LAYOUTS = {
  // A4 sheet, 3 × 7 labels of 63.5 × 38.1 mm
  avery_l7160: { page: '@page{size:A4;margin:15mm 7mm}', grid: 'display:grid;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:38.1mm;column-gap:2.5mm', w: '63.5mm', h: '38.1mm' },
  // Dymo 99012, 89 × 36 mm continuous
  dymo_99012: { page: '@page{size:89mm 36mm;margin:0}', grid: 'display:block', w: '89mm', h: '36mm' },
  // Brother DK-11209, 62 × 29 mm
  brother_62x29: { page: '@page{size:62mm 29mm;margin:0}', grid: 'display:block', w: '62mm', h: '29mm' },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** FR-SCAN-1: printable sheets in common label sizes, or ZPL for thermal printers. */
export function renderLabels(items: LabelItem[], opts: { format: 'html' | 'zpl'; symbology: 'code128' | 'qr'; layout: keyof typeof LAYOUTS }) {
  if (opts.format === 'zpl') {
    const zpl = items
      .map((i) =>
        opts.symbology === 'qr'
          ? `^XA^CI28^FO20,20^BQN,2,6^FDQA,${i.code}^FS^FO200,30^A0N,28,28^FD${i.title}^FS^FO200,70^A0N,24,24^FD${i.code}^FS^XZ`
          : `^XA^CI28^FO20,20^A0N,28,28^FD${i.title}^FS^FO20,60^BY2^BCN,80,Y,N,N^FD${i.code}^FS^XZ`,
      )
      .join('\n');
    return { contentType: 'text/plain; charset=utf-8', body: zpl + '\n' };
  }
  const L = LAYOUTS[opts.layout];
  const cells = items
    .map((i) => {
      const svg = bwipjs.toSVG(opts.symbology === 'qr' ? { bcid: 'qrcode', text: i.code, scale: 2 } : { bcid: 'code128', text: i.code, scale: 2, height: 10, includetext: true, textxalign: 'center' });
      return `<div class="l"><div class="t">${esc(i.title)}</div>${i.subtitle ? `<div class="s">${esc(i.subtitle)}</div>` : ''}<div class="b">${svg}</div></div>`;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>${L.page}
body{margin:0;font-family:system-ui,sans-serif}.g{${L.grid}}.l{width:${L.w};height:${L.h};box-sizing:border-box;padding:2mm 3mm;overflow:hidden;display:flex;flex-direction:column;page-break-inside:avoid}
.t{font-weight:700;font-size:9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.s{font-size:7pt;color:#444}.b{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}.b svg{max-width:100%;max-height:100%}
${opts.layout !== 'avery_l7160' ? '.l{page-break-after:always}' : ''}</style></head><body><div class="g">${cells}</div><script>window.onload=()=>window.print&&setTimeout(()=>window.print(),200)</script></body></html>`;
  return { contentType: 'text/html; charset=utf-8', body: html };
}
