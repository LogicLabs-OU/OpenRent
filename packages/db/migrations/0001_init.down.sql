DROP TABLE IF EXISTS plugins, checkout_sessions, idempotency_keys, webhook_deliveries, webhook_events, outbox,
  webhook_endpoints, notifications, notification_templates, damage_charges, deposits, provider_events,
  payment_intents, payments, payment_providers, documents, document_templates, document_sequences,
  order_line_units, allocations, downtimes, order_events, order_lines, orders, order_sequences, coupons,
  customers, bundle_components, bundles, stock_adjustments, stock_levels, stock_items, variants,
  product_categories, products, categories, price_structures, tax_profiles, audit_log, api_keys, login_tokens,
  sessions, memberships, users, location_blackouts, locations, tenants CASCADE;
DROP FUNCTION IF EXISTS openrent_tenant_ok(text), openrent_touch_updated_at(), openrent_audit_append_only(),
  openrent_orders_bump_version(), openrent_price_snapshot_frozen(), openrent_variant_tracking_guard(),
  openrent_documents_immutable();
