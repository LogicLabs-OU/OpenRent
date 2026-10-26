import QRCode from 'qrcode';
import { sf, fail } from '#lib/server/api.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const token = event.params.token;
  // Back from the payment page: Stripe adds ?payment_intent=…&redirect_status=succeeded|processing|failed.
  const redirect = event.url.searchParams.get('redirect_status');
  const payment_result = redirect === 'succeeded' || redirect === 'processing' || redirect === 'failed' ? redirect : null;
  try {
    const order = payment_result
      ? await sf(event, `/orders/${encodeURIComponent(token)}/payments/sync`, { method: 'POST', body: { token } })
      : await sf(event, `/orders/${encodeURIComponent(token)}?token=${encodeURIComponent(token)}`);
    const qr_svg = await QRCode.toString(event.url.href.split('?')[0]!, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { order: { ...order, qr_svg, token }, payment_result };
  } catch (e) {
    fail(e);
  }
};
