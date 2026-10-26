import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhook } from '../src/webhooks.ts';

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1","type":"order.created"}';
  const t = 1761311942;
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  it('accepts a valid signature within tolerance', async () => {
    expect(await verifyWebhook(body, `t=${t},v1=${sig}`, secret, { now: t + 10 })).toBe(true);
  });
  it('accepts when any v1 matches (secret rotation)', async () => {
    expect(await verifyWebhook(body, `t=${t},v1=deadbeef,v1=${sig}`, secret, { now: t })).toBe(true);
  });
  it('rejects tampered bodies, wrong secrets and stale timestamps', async () => {
    expect(await verifyWebhook(body + ' ', `t=${t},v1=${sig}`, secret, { now: t })).toBe(false);
    expect(await verifyWebhook(body, `t=${t},v1=${sig}`, 'other', { now: t })).toBe(false);
    expect(await verifyWebhook(body, `t=${t},v1=${sig}`, secret, { now: t + 301 })).toBe(false);
  });
});
