import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSlackFake, type SlackFake } from '@openrent/messaging-fakes';
import { postNotice, slackMessage, wanted, webhookUrl } from '../src/index.ts';

describe('Slack notices', () => {
  let slack: SlackFake;
  beforeAll(async () => {
    slack = await startSlackFake({ minIntervalMs: 300 });
  });
  afterAll(() => slack?.close());

  it('writes the notice as Slack text with a link', () => {
    expect(slackMessage({ kind: 'staff_new_order', text: 'New booking #12 from Anna & <Co>', url: 'https://rent.test/admin/orders/ord_1' })).toEqual({
      text: 'New booking #12 from Anna &amp; &lt;Co&gt; <https://rent.test/admin/orders/ord_1|Open>',
    });
  });

  it('sends every kind until the shop turns one off, and only to Slack', () => {
    expect(wanted({}, 'staff_overdue')).toBe(true);
    expect(wanted({ kind_staff_overdue: false }, 'staff_overdue')).toBe(false);
    expect(wanted({}, 'something_else')).toBe(false);
    expect(webhookUrl({ webhook_url: ' https://hooks.slack.com/services/T0/B0/abc ' })).toBe('https://hooks.slack.com/services/T0/B0/abc');
    expect(webhookUrl({ webhook_url: 'https://evil.test/services/T0/B0/abc' })).toBeNull();
    expect(webhookUrl({ webhook_url: slack.webhookUrl }, true)).toBe(slack.webhookUrl);
  });

  it('posts, waits once when Slack asks, and reports what Slack refuses', async () => {
    await postNotice(slack.webhookUrl, { kind: 'staff_new_order', text: 'One', url: null });
    await postNotice(slack.webhookUrl, { kind: 'staff_new_order', text: 'Two', url: null });
    expect(slack.messages.map((m) => m.text)).toEqual(['One', 'Two']);
    await expect(postNotice(`${slack.url}/services/T1/B1/wrong`, { kind: 'x', text: 'x', url: null })).rejects.toThrow('invalid_token');
    slack.archive();
    await expect(postNotice(slack.webhookUrl, { kind: 'x', text: 'x', url: null })).rejects.toThrow('channel_is_archived');
  });
});
