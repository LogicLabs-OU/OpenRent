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
