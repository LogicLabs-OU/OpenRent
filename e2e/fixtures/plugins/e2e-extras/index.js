// Test-stack plugin: a dashboard card, an optional checkout field, a badge for products tagged e2e-badge
// and a "Ledger" integration that connects with an API key (e2e/integrations.spec.ts).
export default {
  id: 'e2e-extras',
  name: 'E2E extras',
  version: '1.0.0',
  compat: '^1.2.0',
  setup(api) {
    api.storefront({
      checkoutFields: [{ key: 'arrival_note', type: 'text', label: { en: 'Arrival note' } }],
      productBadges: [{ tag: 'e2e-badge', label: { en: 'Staff pick' }, tone: 'success' }],
    });
    api.registerIntegration({
      id: 'e2e-ledger',
      name: 'Ledger',
      category: 'other',
      auth: { type: 'fields', fields: [{ key: 'api_key', label: 'API key', type: 'secret', required: true }] },
      events: ['document.issued', 'payment.succeeded'],
      settings: [{ key: 'journal', label: 'Journal name', type: 'text' }],
      async onConnected(ctx) {
        if (ctx.credentials.api_key !== 'ledger-key') throw new Error('Unknown API key');
        return { accountName: 'E2E Ledger' };
      },
      async handle(ctx, task) {
        if (task.object.type !== 'document') return { status: 'skipped' };
        const invoice = await ctx.data.accounting.invoice(task.object.id);
        return { status: 'done', message: `Invoice ${invoice.number} sent` };
      },
    });
  },
};
