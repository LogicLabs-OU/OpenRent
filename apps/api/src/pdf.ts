import type { Browser } from 'playwright';
import { AppError, files, serverT, type Ctx } from '@openrent/core';

/**
 * HTML → PDF with headless Chromium (PRD FR-DOC-2). One browser per process, one isolated context per
 * document. Document HTML is rendered with JavaScript off and may only load https: and data: resources.
 */
let launching: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  launching ??= (async () => {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
    b.on('disconnected', () => (launching = null));
    return b;
  })();
  try {
    return await launching;
  } catch (err) {
    launching = null;
    throw new AppError('pdf_renderer_unavailable', 503, serverT('pdf.unavailable'), { cause: err });
  }
}

export async function renderPdf(html: string): Promise<Buffer> {
  const b = await browser();
  const context = await b.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith('data:') || url.startsWith('https://') ? route.continue() : route.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } finally {
    await context.close();
  }
}

export async function closePdfRenderer() {
  const b = launching ? await launching.catch(() => null) : null;
  launching = null;
  await b?.close();
}

/** Issued documents never change, so a rendered PDF is stored once and reused. */
export async function documentPdf(ctx: Ctx, doc: { id: string; type: string; number: string | null; html: string }): Promise<{ filename: string; body: Buffer }> {
  const existing = await files.findFile(ctx, 'document', doc.id, 'pdf');
  if (existing) return { filename: existing.filename, body: await files.readFile(ctx, existing) };
  const body = await renderPdf(doc.html);
  const filename = `${doc.type}-${(doc.number ?? doc.id).replace(/[^\w.-]+/g, '-')}.pdf`;
  await files.putFile(ctx, { kind: 'pdf', ownerType: 'document', ownerId: doc.id, filename, contentType: 'application/pdf', body });
  return { filename, body };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The issued PDF with a signature page added (FR-DOC-5). The page is rendered like any document, so it
 * writes every script; the issued pages are copied unchanged.
 */
export function signedPdfMaker(ctx: Ctx, doc: { id: string; type: string; number: string | null; html: string }, locale: string) {
  return async (s: { signer_name: string; signer_email: string; method: string; image: Buffer | null; signed_at: Date; html_sha256: string; ip: string | null }) => {
    const { PDFDocument } = await import('pdf-lib');
    const base = await documentPdf(ctx, doc);
    const tr = (key: string, p: Record<string, string | number> = {}) => serverT(key as any, p, locale);
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC' }).format(s.signed_at);
    const html = `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><style>
      body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Hiragino Sans','Noto Sans JP',sans-serif;color:#111827;font-size:12px;margin:0}
      h1{font-size:18px;margin:0 0 16px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0}dt{color:#6b7280}dd{margin:0;word-break:break-all}
      .sig{margin:24px 0;padding:12px;border:1px solid #e5e7eb;border-radius:6px;min-height:60px}.sig img{max-height:90px}.typed{font-size:22px;font-style:italic}
    </style></head><body>
      <h1>${esc(tr('signature.pdf.title'))}</h1>
      <div class="sig">${s.image ? `<img alt="" src="data:image/png;base64,${s.image.toString('base64')}">` : `<span class="typed">${esc(s.signer_name)}</span>`}</div>
      <dl>
        <dt>${esc(tr('signature.pdf.signer'))}</dt><dd>${esc(s.signer_name)} &lt;${esc(s.signer_email)}&gt;</dd>
        <dt>${esc(tr('signature.pdf.signed_at'))}</dt><dd>${esc(when)}</dd>
        <dt>${esc(tr('signature.pdf.method'))}</dt><dd>${esc(tr(`signature.pdf.method_${s.method}`))}</dd>
        ${s.ip ? `<dt>${esc(tr('signature.pdf.ip'))}</dt><dd>${esc(s.ip)}</dd>` : ''}
        <dt>${esc(tr('signature.pdf.hash'))}</dt><dd>${esc(s.html_sha256)}</dd>
      </dl>
    </body></html>`;
    const page = await renderPdf(html);
    const out = await PDFDocument.load(base.body);
    const extra = await PDFDocument.load(page);
    for (const p of await out.copyPages(extra, extra.getPageIndices())) out.addPage(p);
    return Buffer.from(await out.save({ useObjectStreams: false }));
  };
}
