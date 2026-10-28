/**
 * Live check of the Documenso and DocuSign signing plugins against the real services. Opt-in: a service is
 * checked only when its credentials are set. Each check sends a one-page test PDF for signing to
 * SIGN_LIVE_EMAIL, reads its status back, and leaves the request in the service for you to sign or void.
 *
 *   SIGN_LIVE_EMAIL=you@example.com
 *   DOCUMENSO_API_KEY=api_...  [DOCUMENSO_URL=https://app.documenso.com]
 *   DOCUSIGN_INTEGRATION_KEY=...  DOCUSIGN_USER_ID=...  DOCUSIGN_PRIVATE_KEY_FILE=private.pem  [DOCUSIGN_ENV=demo]
 *
 *   pnpm test:signatures-live
 */
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createDocumensoProvider } from '@openrent/plugin-sign-documenso';
import { createDocuSignProvider } from '@openrent/plugin-sign-docusign';

const env = (k: string) => process.env[k]?.trim() ?? '';
const logger = { info() {}, warn() {}, error: console.error, debug() {} };
const email = env('SIGN_LIVE_EMAIL');
if (!email) {
  console.log('Set SIGN_LIVE_EMAIL and a service’s credentials to run the live check.');
  process.exit(0);
}

const doc = await PDFDocument.create();
doc.addPage().drawText('OpenRent live check: please sign or void.', { x: 50, y: 750, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
const pdf = await doc.save();
const req = { documentId: 'doc_live_check', documentUrl: '', signer: { name: 'OpenRent live check', email }, title: 'OpenRent live check', locale: 'en', pdf: async () => pdf };

let failed = false;
async function check(name: string, run: () => Promise<string>) {
  try {
    console.log(`${name}: ${await run()}`);
  } catch (err) {
    failed = true;
    console.error(`${name}: ${(err as Error).message}`);
  }
}

if (env('DOCUMENSO_API_KEY')) {
  await check('Documenso', async () => {
    const ctx = { tenantId: 'live-check', logger, config: { api_key: env('DOCUMENSO_API_KEY'), api_url: env('DOCUMENSO_URL') || 'https://app.documenso.com' } };
    const p = createDocumensoProvider();
    const r = await p.requestSignature(ctx, req);
    return `sent ${r.ref}, status ${await p.status!(ctx, r.ref)}`;
  });
}
if (env('DOCUSIGN_INTEGRATION_KEY')) {
  await check('DocuSign', async () => {
    const ctx = {
      tenantId: 'live-check', logger,
      config: { environment: env('DOCUSIGN_ENV') || 'demo', integration_key: env('DOCUSIGN_INTEGRATION_KEY'), user_id: env('DOCUSIGN_USER_ID'), private_key: readFileSync(env('DOCUSIGN_PRIVATE_KEY_FILE'), 'utf8') },
    };
    const p = createDocuSignProvider();
    const r = await p.requestSignature(ctx, req);
    return `sent ${r.ref}, status ${await p.status!(ctx, r.ref)}`;
  });
}
process.exit(failed ? 1 : 0);
