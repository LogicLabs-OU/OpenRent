// Test-stack plugin: a dashboard card, an optional checkout field and a badge for products tagged e2e-badge.
export default {
  id: 'e2e-extras',
  name: 'E2E extras',
  version: '1.0.0',
  compat: '^1.1.0',
  setup(api) {
    api.storefront({
      checkoutFields: [{ key: 'arrival_note', type: 'text', label: { en: 'Arrival note' } }],
      productBadges: [{ tag: 'e2e-badge', label: { en: 'Staff pick' }, tone: 'success' }],
    });
  },
};
